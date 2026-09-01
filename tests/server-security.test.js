import { expect, test } from "bun:test";
import { buildServer } from "../server";
import { InMemorySessionStore } from "../src/server/session-store";

test("serves strict browser headers and applies a human-sized auth rate limit", async () => {
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

		for (let attempt = 0; attempt < 10; attempt += 1) {
			const response = await server.inject({
				method: "POST",
				payload: { email: "person@example.com" },
				url: "/bff/auth/send-otp",
			});
			expect(response.statusCode).toBe(204);
		}
		const limited = await server.inject({
			method: "POST",
			payload: { email: "person@example.com" },
			url: "/bff/auth/send-otp",
		});
		expect(limited.statusCode).toBe(429);
		expect(limited.json()).toEqual({ error: "rate_limited" });
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
					sessionId,
					status: 500,
				}),
			]),
		);
		expect(logs.join("\n")).not.toContain("server-only-token");
		expect(logs.join("\n")).not.toContain("spoken transcript");
	} finally {
		await server.close();
	}
});
