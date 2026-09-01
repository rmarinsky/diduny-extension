import { expect, test } from "bun:test";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../server";
import {
	InMemorySessionStore,
	SqliteSessionStore,
} from "../src/server/session-store";

test("persists a BFF session across a local SQLite store reopen", async () => {
	const databasePath = join(
		tmpdir(),
		`diduny-session-${crypto.randomUUID()}.db`,
	);
	const store = new SqliteSessionStore(databasePath, "test-session-secret");
	const sessionId = await store.create({
		accessToken: "server-only-token",
		email: "person@example.com",
		refreshToken: "refresh-token",
	});
	store.close();
	expect((await stat(databasePath)).mode & 0o777).toBe(0o600);
	expect((await readFile(databasePath)).toString()).not.toContain(
		"server-only-token",
	);

	const reopened = new SqliteSessionStore(databasePath, "test-session-secret");
	expect(await reopened.get(sessionId)).toEqual({
		accessToken: "server-only-token",
		email: "person@example.com",
		refreshToken: "refresh-token",
	});
	reopened.close();
	await rm(databasePath, { force: true });
});

test("relays an allowlisted BFF request to the upstream backend with a server-held bearer token", async () => {
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only-token" });
	const calls = [];
	const server = await buildServer({
		fetch: async (url, init) => {
			calls.push({ headers: init?.headers, url: String(url) });
			return Response.json({ isWhitelisted: true, usedHours: 0, usedMs: 0 });
		},
		sessions,
		upstreamUrl: "http://upstream.test",
	});

	const response = await server.inject({
		headers: { cookie: `diduny_session=${sessionId}` },
		method: "GET",
		url: "/bff/api/usage/me",
	});

	expect(response.statusCode).toBe(200);
	expect(response.json()).toEqual({
		isWhitelisted: true,
		usedHours: 0,
		usedMs: 0,
	});
	expect(calls).toEqual([
		{
			headers: { authorization: "Bearer server-only-token" },
			url: "http://upstream.test/api/v1/usage/me",
		},
	]);

	await server.close();
});

test("never forwards an unknown path or a request without a BFF session", async () => {
	const calls = [];
	const server = await buildServer({
		fetch: async () => {
			calls.push("upstream");
			return Response.json({});
		},
		upstreamUrl: "http://upstream.test",
	});

	const [unknown, anonymous] = await Promise.all([
		server.inject({ method: "GET", url: "/bff/api/not-allowed" }),
		server.inject({ method: "GET", url: "/bff/api/usage/me" }),
	]);

	expect(unknown.statusCode).toBe(404);
	expect(anonymous.statusCode).toBe(401);
	expect(calls).toEqual([]);

	await server.close();
});

test("distinguishes an unreachable upstream from an upstream response", async () => {
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only-token" });
	const server = await buildServer({
		fetch: async () => {
			throw new Error("connection refused");
		},
		sessions,
		upstreamUrl: "http://upstream.test",
	});

	const response = await server.inject({
		headers: { cookie: `diduny_session=${sessionId}` },
		method: "GET",
		url: "/bff/api/usage/me",
	});

	expect(response.statusCode).toBe(502);
	expect(response.json()).toEqual({ error: "upstream_unreachable" });

	await server.close();
});

test("preserves an upstream quota response instead of relabeling it as BFF auth", async () => {
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only-token" });
	const server = await buildServer({
		fetch: async () =>
			Response.json({ limitHours: 2, usedHours: 2 }, { status: 402 }),
		sessions,
		upstreamUrl: "http://upstream.test",
	});

	const response = await server.inject({
		headers: { cookie: `diduny_session=${sessionId}` },
		method: "GET",
		url: "/bff/api/usage/me",
	});

	expect(response.statusCode).toBe(402);
	expect(response.json()).toEqual({ limitHours: 2, usedHours: 2 });

	await server.close();
});
