import { afterEach, expect, test } from "bun:test";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import WebSocket from "ws";
import { buildServer } from "../server";
import { InMemorySessionStore } from "../src/server/session-store";

const servers = [];

afterEach(async () => {
	for (const server of servers.splice(0).reverse()) {
		for (const socket of server.websocketServer?.clients ?? [])
			socket.terminate();
		server.server.closeAllConnections?.();
		await server.close();
	}
});

function once(socket, event) {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error(`Timed out waiting for ${event}`)),
			2_000,
		);
		socket.once(event, (...args) => {
			clearTimeout(timeout);
			resolve(args);
		});
	});
}

function connect(url, headers) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, { headers });
		let opened = false;
		socket.on("error", (error) => {
			if (!opened) reject(error);
		});
		socket.once("open", () => {
			opened = true;
			resolve(socket);
		});
	});
}

function connectUntilClose(url, headers) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, { headers });
		let opened = false;
		socket.on("error", (error) => {
			if (!opened) reject(error);
		});
		socket.on("open", () => {
			opened = true;
		});
		socket.on("close", (...args) => resolve(args));
	});
}

async function waitFor(check) {
	const deadline = Date.now() + 2_000;
	while (!check()) {
		if (Date.now() >= deadline)
			throw new Error("Timed out waiting for relay cleanup");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

test("relays websocket text and binary frames while attaching the upstream token only server-side", async () => {
	let upstreamToken;
	let upstreamCloseCode;
	const upstream = Fastify();
	servers.push(upstream);
	await upstream.register(websocket);
	upstream.get("/api/v1/usage/me", async () => ({ remaining_seconds: 60 }));
	upstream.get("/api/v1/realtime", { websocket: true }, (socket, request) => {
		upstreamToken = new URL(
			request.raw.url,
			"http://upstream.test",
		).searchParams.get("token");
		socket.on("message", (data, isBinary) =>
			socket.send(data, { binary: isBinary }),
		);
		socket.on("close", (code) => {
			upstreamCloseCode = code;
		});
	});
	await upstream.listen({ host: "127.0.0.1", port: 0 });
	const upstreamAddress = upstream.server.address();
	const upstreamUrl = `http://127.0.0.1:${upstreamAddress.port}`;

	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only-token" });
	const bff = await buildServer({ sessions, upstreamUrl });
	servers.push(bff);
	const bffUrl = await bff.listen({ host: "127.0.0.1", port: 0 });
	const client = await connect(`${bffUrl.replace("http", "ws")}/bff/realtime`, {
		cookie: `diduny_session=${sessionId}`,
	});

	const text = once(client, "message");
	client.send('{"tokens":[{"text":"<end>","is_final":true}]}');
	expect(String((await text)[0])).toBe(
		'{"tokens":[{"text":"<end>","is_final":true}]}',
	);

	const binary = once(client, "message");
	client.send(Buffer.from([0, 1, 2, 3]));
	expect(Buffer.from((await binary)[0])).toEqual(Buffer.from([0, 1, 2, 3]));
	expect(upstreamToken).toBe("server-only-token");

	client.close(1001);
	await once(client, "close");
	await waitFor(() => upstream.websocketServer.clients.size === 0);
	expect(upstreamCloseCode).toBe(1000);
	expect(
		(await bff.inject({ method: "GET", url: "/bff/health" })).json(),
	).toEqual({
		activeRealtimeSockets: 0,
		status: "ok",
	});
});

test("rejects an unauthenticated websocket upgrade before connecting upstream", async () => {
	const bff = await buildServer({ upstreamUrl: "http://127.0.0.1:3910" });
	servers.push(bff);
	const bffUrl = await bff.listen({ host: "127.0.0.1", port: 0 });

	await expect(
		connect(`${bffUrl.replace("http", "ws")}/bff/realtime`),
	).rejects.toThrow("Expected 101 status code");
});

test("reports quota exhaustion with a websocket close code without opening the upstream socket", async () => {
	let realtimeOpened = false;
	const upstream = Fastify();
	servers.push(upstream);
	await upstream.register(websocket);
	upstream.get("/api/v1/usage/me", async (_request, reply) =>
		reply.code(402).send({ error: "quota" }),
	);
	upstream.get("/api/v1/realtime", { websocket: true }, () => {
		realtimeOpened = true;
	});
	await upstream.listen({ host: "127.0.0.1", port: 0 });
	const upstreamAddress = upstream.server.address();
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only-token" });
	const bff = await buildServer({
		sessions,
		upstreamUrl: `http://127.0.0.1:${upstreamAddress.port}`,
	});
	servers.push(bff);
	const bffUrl = await bff.listen({ host: "127.0.0.1", port: 0 });
	const [code, reason] = await connectUntilClose(
		`${bffUrl.replace("http", "ws")}/bff/realtime`,
		{
			cookie: `diduny_session=${sessionId}`,
		},
	);
	expect(code).toBe(4002);
	expect(String(reason)).toBe("usage exhausted");
	expect(realtimeOpened).toBe(false);
	await waitFor(() => bff.websocketServer.clients.size === 0);
	expect(
		(await bff.inject({ method: "GET", url: "/bff/health" })).json(),
	).toEqual({
		activeRealtimeSockets: 0,
		status: "ok",
	});
});

test("refuses a second concurrent realtime socket for one BFF session", async () => {
	const upstream = Fastify();
	servers.push(upstream);
	await upstream.register(websocket);
	upstream.get("/api/v1/usage/me", async () => ({ remaining_seconds: 60 }));
	upstream.get("/api/v1/realtime", { websocket: true }, () => {});
	await upstream.listen({ host: "127.0.0.1", port: 0 });
	const upstreamAddress = upstream.server.address();
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only-token" });
	const bff = await buildServer({
		sessions,
		upstreamUrl: `http://127.0.0.1:${upstreamAddress.port}`,
	});
	servers.push(bff);
	const bffUrl = await bff.listen({ host: "127.0.0.1", port: 0 });
	const realtimeUrl = `${bffUrl.replace("http", "ws")}/bff/realtime`;
	const headers = { cookie: `diduny_session=${sessionId}` };
	const first = await connect(realtimeUrl, headers);

	await expect(connect(realtimeUrl, headers)).rejects.toThrow(
		"Expected 101 status code",
	);
	first.close();
	await once(first, "close");
	await waitFor(() => upstream.websocketServer.clients.size === 0);
	await waitFor(() => bff.websocketServer.clients.size === 0);
});
