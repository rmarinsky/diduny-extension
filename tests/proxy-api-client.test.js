import { expect, test } from "bun:test";
import {
	AuthenticationError,
	MemoryTokenStore,
	ProxyApiClient,
	UsageLimitError,
	decodeTranscriptResult,
} from "../src/core";

const encoder = new TextEncoder();

function json(status, value) {
	return { body: encoder.encode(JSON.stringify(value)), headers: {}, status };
}

function tokens(accessToken, expiresAt = 120_000) {
	return {
		accessToken,
		email: "person@example.com",
		expiresAt,
		refreshToken: "refresh-token",
	};
}

test("joins ten concurrent 401 responses into one token refresh", async () => {
	let refreshCalls = 0;
	const store = new MemoryTokenStore(tokens("old-token"));
	const client = new ProxyApiClient({
		clock: { now: () => 0 },
		http: {
			isAvailable: true,
			async send(request) {
				if (request.path === "/api/v1/auth/refresh") {
					refreshCalls += 1;
					return json(200, {
						accessToken: "new-token",
						accessTokenExpiresAt: 120_000,
						refreshToken: "rotated-refresh-token",
					});
				}
				return request.headers?.Authorization === "Bearer new-token"
					? json(200, { isWhitelisted: true, usedHours: 0, usedMs: 0 })
					: json(401, { error: "expired" });
			},
		},
		tokens: store,
	});

	const usage = await Promise.all(
		Array.from({ length: 10 }, () => client.usage()),
	);

	expect(refreshCalls).toBe(1);
	expect(usage).toHaveLength(10);
	expect((await store.read())?.refreshToken).toBe("rotated-refresh-token");
});

test("retries an unauthorized request once and preserves a second 401 as auth failure", async () => {
	let refreshCalls = 0;
	const client = new ProxyApiClient({
		clock: { now: () => 0 },
		http: {
			isAvailable: true,
			async send(request) {
				if (request.path === "/api/v1/auth/refresh") {
					refreshCalls += 1;
					return json(200, {
						accessToken: "new-token",
						accessTokenExpiresAt: 120_000,
						refreshToken: "new-refresh-token",
					});
				}
				return json(401, { error: "expired" });
			},
		},
		tokens: new MemoryTokenStore(tokens("old-token")),
	});

	await expect(client.usage()).rejects.toBeInstanceOf(AuthenticationError);
	expect(refreshCalls).toBe(1);
});

test("refreshes proactively before using a token inside the lead window", async () => {
	const paths = [];
	const client = new ProxyApiClient({
		clock: { now: () => 1000 },
		http: {
			isAvailable: true,
			async send(request) {
				paths.push(request.path);
				if (request.path === "/api/v1/auth/refresh") {
					return json(200, {
						accessToken: "fresh-token",
						accessTokenExpiresAt: 120_000,
						refreshToken: "fresh-refresh-token",
					});
				}
				return json(200, { isWhitelisted: true, usedHours: 0, usedMs: 0 });
			},
		},
		tokens: new MemoryTokenStore(tokens("old-token", 60_000)),
	});

	await client.usage();

	expect(paths).toEqual(["/api/v1/auth/refresh", "/api/v1/usage/me"]);
});

test("clears any partial stored token set before it can authorize a request", async () => {
	const store = new MemoryTokenStore({
		...tokens("access-token"),
		refreshToken: undefined,
	});
	const client = new ProxyApiClient({
		clock: { now: () => 0 },
		http: {
			isAvailable: true,
			async send() {
				throw new Error("A partial session must not issue a request");
			},
		},
		tokens: store,
	});

	await expect(client.usage()).rejects.toBeInstanceOf(AuthenticationError);
	expect(await store.read()).toBeNull();
});

test("keeps cached usage when an optional refresh fails or cannot decode", async () => {
	let failure = null;
	const client = new ProxyApiClient({
		clock: { now: () => 0 },
		http: {
			isAvailable: true,
			async send() {
				if (failure === "decode") return json(200, { malformed: true });
				if (failure === "request") return json(500, { error: "unavailable" });
				return json(200, {
					isWhitelisted: true,
					usedHours: 0,
					usedMs: 0,
				});
			},
		},
		tokens: new MemoryTokenStore(tokens("valid-token")),
	});

	const cached = await client.refreshUsage();
	failure = "request";
	expect(await client.refreshUsage()).toEqual(cached);
	failure = "decode";
	expect(await client.refreshUsage()).toEqual(cached);
});

test("normalizes tolerant transcript variants and preserves a quota error", () => {
	expect(
		decodeTranscriptResult({
			transcript: "Hello",
			words: [
				{ endSeconds: 1.2, speaker_index: 2, startSeconds: 0, text: "Hello" },
			],
		}),
	).toEqual({
		text: "Hello",
		tokens: [{ endMs: 1200, speaker: "2", startMs: 0, text: "Hello" }],
	});

	const error = new UsageLimitError("/api/v1/usage/me", 1.5, 2);
	expect(error.usedHours).toBe(1.5);
	expect(error.limitHours).toBe(2);
});
