import { expect, test } from "bun:test";
import {
	bffFetch,
	normalizeBffOrigin,
	normalizeLocalBffOrigin,
} from "./client";

test("normalizes a self-hosted BFF origin without accepting a path", () => {
	expect(normalizeBffOrigin("http://localhost:4317/")).toBe(
		"http://localhost:4317",
	);
	expect(() => normalizeBffOrigin("https://diduny.example/bff")).toThrow(
		"origin only",
	);
	expect(() => normalizeBffOrigin("file:///tmp/diduny")).toThrow(
		"http or https",
	);
});

test("keeps extension BFF configuration on localhost for secure cookies", () => {
	expect(normalizeLocalBffOrigin("http://localhost:4317")).toBe(
		"http://localhost:4317",
	);
	expect(() => normalizeLocalBffOrigin("http://127.0.0.1:4317")).toThrow(
		"localhost",
	);
});

test("sends BFF requests with browser credentials and no authorization header", async () => {
	const originalFetch = globalThis.fetch;
	let seenUrl = "";
	let seenInit: RequestInit | undefined;
	globalThis.fetch = (async (url, init) => {
		seenUrl = String(url);
		seenInit = init;
		return new Response(JSON.stringify({ authenticated: true }), {
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;

	try {
		await bffFetch(
			"/bff/auth/session",
			{ headers: { accept: "application/json" } },
			"http://localhost:4317",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}

	expect(seenUrl).toBe("http://localhost:4317/bff/auth/session");
	expect(seenInit?.credentials).toBe("include");
	expect(new Headers(seenInit?.headers).has("authorization")).toBe(false);
});
