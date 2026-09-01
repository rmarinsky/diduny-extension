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

test("refreshes once then redirects a streamed upload so the browser re-uploads its source", async () => {
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({
		accessToken: "old-token",
		expiresAt: Date.now() + 120_000,
		refreshToken: "old-refresh-token",
	});
	let refreshCalls = 0;
	const transcriptionTokens = [];
	const server = await buildServer({
		fetch: async (url, init) => {
			if (String(url).endsWith("/auth/refresh")) {
				refreshCalls += 1;
				return Response.json({
					accessToken: "new-token",
					accessTokenExpiresAt: Date.now() + 120_000,
					refreshToken: "new-refresh-token",
				});
			}
			if (new URL(String(url)).pathname.endsWith("/transcriptions")) {
				transcriptionTokens.push(init?.headers?.authorization);
				return init?.headers?.authorization === "Bearer new-token"
					? Response.json({ text: "retried upload", tokens: [] })
					: Response.json({ error: "expired" }, { status: 401 });
			}
			throw new Error(`Unexpected upstream request: ${url}`);
		},
		sessions,
		upstreamUrl: "http://upstream.test",
	});
	try {
		const boundary = "diduny-retry-boundary";
		const payload = [
			`--${boundary}`,
			'Content-Disposition: form-data; name="audio"; filename="source.webm"',
			"Content-Type: audio/webm",
			"",
			"source-file-audio",
			`--${boundary}--`,
			"",
		].join("\r\n");
		const first = await server.inject({
			headers: {
				"content-type": `multipart/form-data; boundary=${boundary}`,
				cookie: `diduny_session=${sessionId}`,
			},
			method: "POST",
			payload,
			url: "/bff/api/transcriptions?source=extension",
		});

		expect(first.statusCode).toBe(307);
		expect(first.headers.location).toBe(
			"/bff/api/transcriptions?source=extension&__diduny_retry=1",
		);
		const retry = await server.inject({
			headers: {
				"content-type": `multipart/form-data; boundary=${boundary}`,
				cookie: `diduny_session=${sessionId}`,
			},
			method: "POST",
			payload,
			url: first.headers.location,
		});

		expect(retry.statusCode).toBe(200);
		expect(retry.json()).toEqual({ text: "retried upload", tokens: [] });
		expect(refreshCalls).toBe(1);
		expect(transcriptionTokens).toEqual(["Bearer old-token", "Bearer new-token"]);
	} finally {
		await server.close();
	}
});
