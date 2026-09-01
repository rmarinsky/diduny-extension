import { expect, test } from "bun:test";
import { buildServer } from "../server";
import { InMemorySessionStore } from "../src/server/session-store";

function serverUrl(server) {
	const address = server.server.address();
	if (!address || typeof address === "string")
		throw new Error("BFF did not bind a TCP port");
	return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
	server.server.closeAllConnections?.();
	await server.close();
}

test("relays SSE events as they arrive instead of buffering the stream", async () => {
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only-token" });
	const encoder = new TextEncoder();
	let finish;
	const upstreamBody = new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode("event: status\ndata: processing\n\n"));
			finish = () => {
				controller.enqueue(encoder.encode("event: completed\ndata: done\n\n"));
				controller.close();
			};
		},
	});
	const server = await buildServer({
		fetch: async () =>
			new Response(upstreamBody, {
				headers: { "content-type": "text/event-stream" },
			}),
		sessions,
		upstreamUrl: "http://upstream.test",
	});
	await server.listen({ host: "127.0.0.1", port: 0 });
	try {
		const response = await fetch(
			`${serverUrl(server)}/bff/api/jobs/mock-job/events`,
			{
				headers: { cookie: `diduny_session=${sessionId}` },
				signal: AbortSignal.timeout(500),
			},
		);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Expected an SSE response body");

		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
		expect(response.headers.get("x-accel-buffering")).toBe("no");
		expect(new TextDecoder().decode((await reader.read()).value)).toContain(
			"event: status",
		);
		finish();
		expect(new TextDecoder().decode((await reader.read()).value)).toContain(
			"event: completed",
		);
	} finally {
		await close(server);
	}
});

test("aborts upstream SSE when the downstream client disconnects", async () => {
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only-token" });
	const encoder = new TextEncoder();
	let abortUpstream;
	const upstreamAborted = new Promise((resolve) => {
		abortUpstream = resolve;
	});
	const server = await buildServer({
		fetch: async (_url, init) => {
			init?.signal?.addEventListener("abort", abortUpstream, { once: true });
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode(": opened\n\n"));
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		},
		sessions,
		upstreamUrl: "http://upstream.test",
	});
	await server.listen({ host: "127.0.0.1", port: 0 });
	try {
		const downstream = new AbortController();
		const response = await fetch(
			`${serverUrl(server)}/bff/api/jobs/mock-job/events`,
			{
				headers: { cookie: `diduny_session=${sessionId}` },
				signal: downstream.signal,
			},
		);
		await response.body?.getReader().read();
		downstream.abort();
		expect(await upstreamAborted).toBeDefined();
	} finally {
		await close(server);
	}
});
