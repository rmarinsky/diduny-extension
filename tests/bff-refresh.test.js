import { expect, test } from "bun:test";
import { buildServer } from "../server";
import { InMemorySessionStore } from "../src/server/session-store";

test("joins concurrent BFF 401 responses into one server-side refresh and retries once", async () => {
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({
		accessToken: "old-token",
		expiresAt: Date.now() + 120_000,
		refreshToken: "old-refresh-token",
	});
	let refreshCalls = 0;
	const server = await buildServer({
		fetch: async (url, init) => {
			if (String(url).endsWith("/auth/refresh")) {
				refreshCalls += 1;
				return Response.json({
					accessToken: "new-token",
					accessTokenExpiresAt: 120_000,
					refreshToken: "new-refresh-token",
				});
			}
			return init?.headers?.authorization === "Bearer new-token"
				? Response.json({ isWhitelisted: true, usedHours: 0, usedMs: 0 })
				: Response.json({ error: "expired" }, { status: 401 });
		},
		sessions,
		upstreamUrl: "http://upstream.test",
	});

	const responses = await Promise.all(
		Array.from({ length: 10 }, () =>
			server.inject({
				headers: { cookie: `diduny_session=${sessionId}` },
				method: "GET",
				url: "/bff/api/usage/me",
			}),
		),
	);

	expect(refreshCalls).toBe(1);
	expect(responses.every((response) => response.statusCode === 200)).toBeTrue();
	expect((await sessions.get(sessionId))?.refreshToken).toBe(
		"new-refresh-token",
	);

	await server.close();
});

test("maps a failed server-side refresh to unauthenticated instead of an upstream outage", async () => {
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({
		accessToken: "old-token",
		expiresAt: Date.now() + 120_000,
		refreshToken: "old-refresh-token",
	});
	const server = await buildServer({
		fetch: async (url) =>
			String(url).endsWith("/auth/refresh")
				? Response.json({ error: "invalid refresh" }, { status: 401 })
				: Response.json({ error: "expired" }, { status: 401 }),
		sessions,
		upstreamUrl: "http://upstream.test",
	});

	const response = await server.inject({
		headers: { cookie: `diduny_session=${sessionId}` },
		method: "GET",
		url: "/bff/api/usage/me",
	});

	expect(response.statusCode).toBe(401);
	expect(response.json()).toEqual({ error: "unauthenticated" });
	expect(await sessions.get(sessionId)).toBeNull();

	await server.close();
});
