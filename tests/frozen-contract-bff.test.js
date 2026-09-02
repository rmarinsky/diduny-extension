import { expect, test } from "bun:test";
import WebSocket from "ws";
import { buildServer } from "../server";
import { buildMockProxy } from "../src/mock-proxy";
import { ProxyOtpGateway } from "../src/server/auth";
import { InMemorySessionStore } from "../src/server/session-store";

function serverUrl(server) {
	const address = server.server.address();
	if (!address || typeof address === "string")
		throw new Error("Server did not bind");
	return `http://127.0.0.1:${address.port}`;
}

function bffCookie(response) {
	const value = response.headers.get("set-cookie");
	if (!value) throw new Error("BFF did not set a session cookie");
	return value.split(";")[0];
}

function audioForm() {
	const form = new FormData();
	form.append("audio", new Blob(["audio"], { type: "audio/wav" }), "voice.wav");
	form.append("config", JSON.stringify({ language_hints: ["uk"] }));
	return form;
}

test("runs the frozen mock contract through BFF auth and every HTTP relay path", async () => {
	const mock = await buildMockProxy();
	await mock.server.listen({ host: "127.0.0.1", port: 0 });
	const upstreamUrl = serverUrl(mock.server);
	const sessions = new InMemorySessionStore();
	const bff = await buildServer({
		auth: new ProxyOtpGateway(globalThis.fetch, upstreamUrl),
		sessions,
		upstreamUrl,
	});
	await bff.listen({ host: "127.0.0.1", port: 0 });
	const bffUrl = serverUrl(bff);
	try {
		const sendOtp = await fetch(`${bffUrl}/bff/auth/send-otp`, {
			body: JSON.stringify({ email: "person@example.com" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		expect(sendOtp.status).toBe(204);
		const verifyOtp = await fetch(`${bffUrl}/bff/auth/verify-otp`, {
			body: JSON.stringify({ email: "person@example.com", otp: "123456" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		expect(verifyOtp.status).toBe(200);
		const cookie = bffCookie(verifyOtp);
		const sessionId = decodeURIComponent(
			cookie.slice("diduny_session=".length),
		);
		const headers = { cookie };

		const responses = await Promise.all([
			fetch(`${bffUrl}/bff/api/config`),
			fetch(`${bffUrl}/bff/api/health`),
			fetch(`${bffUrl}/bff/api/models`, { headers }),
			fetch(`${bffUrl}/bff/api/translations?q=Привіт&sl=uk&tl=en`, {
				headers,
			}),
			fetch(`${bffUrl}/bff/api/usage/me`, { headers }),
			fetch(`${bffUrl}/bff/api/transcriptions`, {
				body: audioForm(),
				headers,
				method: "POST",
			}),
			fetch(`${bffUrl}/bff/api/transcriptions/clean`, {
				body: JSON.stringify({ text: "raw" }),
				headers: { ...headers, "content-type": "application/json" },
				method: "POST",
			}),
			fetch(`${bffUrl}/bff/api/jobs`, {
				body: audioForm(),
				headers,
				method: "POST",
			}),
		]);
		for (const response of responses) expect(response.ok).toBe(true);
		const job = await responses[7].json();
		const [jobStatus, events] = await Promise.all([
			fetch(`${bffUrl}/bff/api/jobs/${job.jobId}`, { headers }),
			fetch(`${bffUrl}/bff/api/jobs/${job.jobId}/events`, { headers }),
		]);
		expect(jobStatus.ok).toBe(true);
		expect(await events.text()).toContain("event: completed");

		const stale = await sessions.get(sessionId);
		if (!stale) throw new Error("Expected BFF session");
		await sessions.set(sessionId, { ...stale, expiresAt: Date.now() });
		expect(
			(await fetch(`${bffUrl}/bff/api/usage/me`, { headers })).status,
		).toBe(200);

		const logout = await fetch(`${bffUrl}/bff/auth/logout`, {
			headers,
			method: "POST",
		});
		expect(logout.status).toBe(204);
	} finally {
		bff.server.closeAllConnections?.();
		mock.server.server.closeAllConnections?.();
		await bff.close();
		await mock.server.close();
	}
});

test("relays the frozen mock realtime path with its server-held token", async () => {
	const mock = await buildMockProxy();
	await mock.server.listen({ host: "127.0.0.1", port: 0 });
	const upstreamUrl = serverUrl(mock.server);
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "mock-access-token" });
	const bff = await buildServer({ sessions, upstreamUrl });
	await bff.listen({ host: "127.0.0.1", port: 0 });
	const bffUrl = serverUrl(bff).replace("http", "ws");
	let socket;
	try {
		const frames = [];
		socket = new WebSocket(`${bffUrl}/bff/realtime`, {
			headers: { cookie: `diduny_session=${sessionId}` },
		});
		await new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() =>
					reject(new Error("Timed out waiting for mock realtime finalization")),
				2_000,
			);
			socket.on("open", () => {
				socket.send(JSON.stringify({ audio_format: "s16le" }));
				socket.send(Buffer.from([0, 1]));
				socket.send(JSON.stringify({ type: "finalize" }));
			});
			socket.on("message", (data) => {
				frames.push(data.toString());
				if (frames.some((frame) => frame.includes("<fin>"))) {
					clearTimeout(timeout);
					socket.terminate();
					resolve(undefined);
				}
			});
			socket.on("error", (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
		expect(frames.join("\n")).toContain("proxy_ready");
		expect(frames.join("\n")).toContain("<fin>");
	} finally {
		socket?.terminate();
		for (const client of mock.server.websocketServer?.clients ?? [])
			client.terminate();
		bff.server.closeAllConnections?.();
		mock.server.server.closeAllConnections?.();
		await bff.close();
		await mock.server.close();
	}
});
