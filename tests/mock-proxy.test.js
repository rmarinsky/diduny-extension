import { expect, test } from "bun:test";
import WebSocket from "ws";
import { buildMockProxy } from "../src/mock-proxy";

function serverUrl(server) {
	const address = server.server.address();
	if (!address || typeof address === "string")
		throw new Error("Mock did not bind");
	return `http://127.0.0.1:${address.port}`;
}

test("implements all fifteen frozen proxy paths with a local OTP mailbox", async () => {
	const mock = await buildMockProxy();
	await mock.server.listen({ host: "127.0.0.1", port: 0 });
	const baseUrl = serverUrl(mock.server);
	const auth = { authorization: "Bearer mock-access-token" };
	try {
		const sendOtp = await fetch(`${baseUrl}/api/v1/auth/send-otp`, {
			body: JSON.stringify({ email: "person@example.com" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		expect(sendOtp.status).toBe(204);
		expect(mock.mailbox()).toEqual([
			expect.objectContaining({ email: "person@example.com", otp: "123456" }),
		]);

		const authCalls = await Promise.all([
			fetch(`${baseUrl}/api/v1/auth/verify-otp`, {
				body: JSON.stringify({ email: "person@example.com", otp: "123456" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			fetch(`${baseUrl}/api/v1/auth/refresh`, {
				body: JSON.stringify({ refreshToken: "mock-refresh-token" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			fetch(`${baseUrl}/api/v1/auth/logout`, { headers: auth, method: "POST" }),
		]);
		for (const response of authCalls) expect(response.ok).toBe(true);

		const form = new FormData();
		form.append(
			"audio",
			new Blob(["audio"], { type: "audio/wav" }),
			"voice.wav",
		);
		form.append("config", JSON.stringify({ language_hints: ["uk"] }));
		const transcription = await fetch(`${baseUrl}/api/v1/transcriptions`, {
			body: form,
			headers: auth,
			method: "POST",
		});
		expect(await transcription.json()).toEqual(
			expect.objectContaining({
				text: expect.any(String),
				tokens: expect.any(Array),
			}),
		);

		const clean = await fetch(`${baseUrl}/api/v1/transcriptions/clean`, {
			body: JSON.stringify({ text: "raw" }),
			headers: { ...auth, "content-type": "application/json" },
			method: "POST",
		});
		expect(await clean.json()).toEqual({ text: "raw" });

		const job = await fetch(`${baseUrl}/api/v1/jobs`, {
			body: form,
			headers: auth,
			method: "POST",
		});
		const { jobId } = await job.json();
		expect(typeof jobId).toBe("string");
		const [jobStatus, events] = await Promise.all([
			fetch(`${baseUrl}/api/v1/jobs/${jobId}`, { headers: auth }),
			fetch(`${baseUrl}/api/v1/jobs/${jobId}/events`, { headers: auth }),
		]);
		expect(jobStatus.ok).toBe(true);
		expect(await events.text()).toContain("event: completed");

		const [translations, usage, config, models, health] = await Promise.all([
			fetch(`${baseUrl}/api/v1/translations?q=Привіт&sl=uk&tl=en`, {
				headers: auth,
			}),
			fetch(`${baseUrl}/api/v1/usage/me`, { headers: auth }),
			fetch(`${baseUrl}/api/v1/config`),
			fetch(`${baseUrl}/api/v1/models`, { headers: auth }),
			fetch(`${baseUrl}/api/v1/health`),
		]);
		for (const response of [translations, usage, config, models, health])
			expect(response.ok).toBe(true);

		mock.setBehavior("/api/v1/usage/me", "quota");
		expect(
			(await fetch(`${baseUrl}/api/v1/usage/me`, { headers: auth })).status,
		).toBe(402);
		mock.setBehavior("/api/v1/usage/me", "malformed");
		expect(
			await (
				await fetch(`${baseUrl}/api/v1/usage/me`, { headers: auth })
			).json(),
		).toEqual({ malformed: true });
	} finally {
		await mock.server.close();
	}
});

test("accepts realtime config and PCM frames then emits control tokens", async () => {
	const mock = await buildMockProxy();
	await mock.server.listen({ host: "127.0.0.1", port: 0 });
	const baseUrl = serverUrl(mock.server).replace("http", "ws");
	try {
		const frames = [];
		const socket = new WebSocket(
			`${baseUrl}/api/v1/realtime?token=mock-access-token`,
		);
		await new Promise((resolve, reject) => {
			socket.on("open", () => {
				socket.send(JSON.stringify({ audio_format: "s16le" }));
				socket.send(new Uint8Array([0, 1]));
				socket.send(JSON.stringify({ type: "finalize" }));
			});
			socket.on("message", (data) => {
				frames.push(data.toString());
				if (frames.some((frame) => frame.includes("<fin>"))) {
					socket.terminate();
					resolve(undefined);
				}
			});
			socket.on("error", reject);
		});
		expect(frames.join("\n")).toContain("proxy_ready");
		expect(frames.join("\n")).toContain("<end>");
		expect(frames.join("\n")).toContain("<fin>");
	} finally {
		for (const socket of mock.server.websocketServer?.clients ?? [])
			socket.terminate();
		mock.server.server.closeAllConnections?.();
		await mock.server.close();
	}
});
