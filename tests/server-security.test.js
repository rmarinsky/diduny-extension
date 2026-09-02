import { expect, test } from "bun:test";
import { buildServer } from "../server";
import { InMemorySessionStore } from "../src/server/session-store";

test("serves strict browser headers and limits OTP sends per normalized email", async () => {
	const server = await buildServer({
		fetch: async () => new Response(null, { status: 204 }),
	});
	try {
		const health = await server.inject({ method: "GET", url: "/bff/health" });
		expect(health.headers["content-security-policy"]).toContain(
			"connect-src 'self'",
		);
		expect(health.headers["x-frame-options"]).toBe("DENY");
		expect(health.headers["x-content-type-options"]).toBe("nosniff");

		const normalizedEmail = "person@example.com";
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const response = await server.inject({
				method: "POST",
				payload: {
					email: attempt % 2 === 0 ? normalizedEmail : "Person@Example.com",
				},
				remoteAddress: `198.51.100.${String(attempt + 1)}`,
				url: "/bff/auth/send-otp",
			});
			expect(response.statusCode).toBe(204);
		}
		const limited = await server.inject({
			method: "POST",
			payload: { email: normalizedEmail },
			remoteAddress: "198.51.100.200",
			url: "/bff/auth/send-otp",
		});
		expect(limited.statusCode).toBe(429);
		expect(limited.json()).toEqual({ error: "rate_limited" });

		const independent = await server.inject({
			method: "POST",
			payload: { email: "other@example.com" },
			remoteAddress: "198.51.100.200",
			url: "/bff/auth/send-otp",
		});
		expect(independent.statusCode).toBe(204);
	} finally {
		await server.close();
	}
});

test("logs structured request metadata without token or transcript content on an exception", async () => {
	const logs = [];
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only-token" });
	const server = await buildServer({
		log: (line) => logs.push(line),
		sessions,
	});
	server.get("/boom", () => {
		throw new Error("server-only-token spoken transcript");
	});
	try {
		const response = await server.inject({
			headers: { cookie: `diduny_session=${sessionId}` },
			method: "GET",
			url: "/boom",
		});
		expect(response.statusCode).toBe(500);
		expect(response.json()).toEqual({ error: "internal_error" });

		const events = logs.map((line) => JSON.parse(line));
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					bytes: expect.any(Number),
					method: "GET",
					sessionId: expect.any(String),
					status: 500,
				}),
			]),
		);
		expect(logs.join("\n")).not.toContain(sessionId);
		expect(logs.join("\n")).not.toContain("server-only-token");
		expect(logs.join("\n")).not.toContain("spoken transcript");
	} finally {
		await server.close();
	}
});

test("binds extension sessions to the configured extension origin and logs their relay path", async () => {
	const logs = [];
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only-token" });
	const server = await buildServer({
		extensionOrigin: "chrome-extension://diduny-trusted",
		fetch: async () =>
			Response.json({ isWhitelisted: true, usedHours: 0, usedMs: 0 }),
		log: (line) => logs.push(line),
		sessions,
		upstreamUrl: "http://upstream.test",
	});
	try {
		const trusted = await server.inject({
			headers: {
				cookie: `diduny_extension_session=${sessionId}`,
				origin: "chrome-extension://diduny-trusted",
			},
			method: "GET",
			url: "/bff/extension/api/usage/me",
		});
		const untrusted = await server.inject({
			headers: {
				cookie: `diduny_extension_session=${sessionId}`,
				origin: "chrome-extension://untrusted-extension-id",
			},
			method: "GET",
			url: "/bff/extension/api/usage/me",
		});

		expect(trusted.statusCode).toBe(200);
		expect(untrusted.statusCode).toBe(403);
		expect(logs.map((line) => JSON.parse(line))).toContainEqual(
			expect.objectContaining({
				sessionId: expect.any(String),
				upstreamPath: "/api/v1/usage/me",
			}),
		);
		expect(logs.join("\n")).not.toContain(sessionId);
	} finally {
		await server.close();
	}
});
