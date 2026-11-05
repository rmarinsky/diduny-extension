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
		expect(mock.transcriptions()).toEqual([
			expect.objectContaining({
				authorization: "Bearer mock-access-token",
				body: expect.stringContaining('name="audio"'),
				bytes: expect.any(Number),
				contentType: expect.stringContaining("multipart/form-data"),
			}),
		]);

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

test("exposes rotating sessions and mutable frozen-contract variants", async () => {
	const mock = await buildMockProxy();
	await mock.server.listen({ host: "127.0.0.1", port: 0 });
	const baseUrl = serverUrl(mock.server);
	const auth = { authorization: "Bearer mock-access-token" };
	try {
		const firstRefresh = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
			body: JSON.stringify({ refreshToken: "mock-refresh-token" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const firstTokens = await firstRefresh.json();
		expect(firstTokens.refreshToken).not.toBe("mock-refresh-token");
		expect(
			(
				await fetch(`${baseUrl}/api/v1/auth/refresh`, {
					body: JSON.stringify({ refreshToken: "mock-refresh-token" }),
					headers: { "content-type": "application/json" },
					method: "POST",
				})
			).status,
		).toBe(401);

		mock.setConfig({
			endpoints: { sttBaseURL: "mock://changed", sttModel: "changed" },
			featureFlags: { realtime: false },
			messages: { maintenance: "now" },
			version: "changed",
		});
		expect(await (await fetch(`${baseUrl}/api/v1/config`)).json()).toEqual({
			endpoints: { sttBaseURL: "mock://changed", sttModel: "changed" },
			featureFlags: { realtime: false },
			messages: { maintenance: "now" },
			version: "changed",
		});

		const socket = new WebSocket(
			`${baseUrl.replace("http", "ws")}/api/v1/realtime?token=mock-access-token`,
		);
		await new Promise((resolve, reject) => {
			socket.on("message", (data) => {
				if (String(data).includes("proxy_ready")) {
					socket.send('{"audio_format":"s16le"}');
					socket.send(Buffer.from([1, 2]));
					socket.send('{"type":"finalize"}');
				} else if (String(data).includes("<fin>")) {
					socket.close();
				}
			});
			socket.once("close", resolve);
			socket.once("error", reject);
		});
		expect(mock.realtimeFrames()).toEqual([
			{ data: '{"audio_format":"s16le"}', isBinary: false },
			{ data: Buffer.from([1, 2]), isBinary: true },
			{ data: '{"type":"finalize"}', isBinary: false },
		]);
	} finally {
		for (const socket of mock.server.websocketServer?.clients ?? [])
			socket.terminate();
		mock.server.server.closeAllConnections?.();
		await mock.server.close();
	}
});

test("numbers transcripts only when asked, so tests keep the fixed text", async () => {
	const transcribe = (mock) =>
		mock.server
			.inject({
				headers: { authorization: "Bearer mock-access-token" },
				method: "POST",
				payload: {},
				url: "/api/v1/transcriptions",
			})
			.then((response) => response.json());

	const numbered = await buildMockProxy({ numberTranscripts: true });
	const first = await transcribe(numbered);
	const second = await transcribe(numbered);
	expect(first.text).toBe("Mock transcript 1");
	expect(first.tokens[0].text).toBe("Mock transcript 1");
	expect(second.text).toBe("Mock transcript 2");
	await numbered.server.close();

	const fixed = await buildMockProxy();
	expect((await transcribe(fixed)).text).toBe("Mock transcript");
	expect((await transcribe(fixed)).text).toBe("Mock transcript");
	await fixed.server.close();
});

test("streams the transcript word by word only when asked, ending on the same text", async () => {
	const mock = await buildMockProxy({
		numberTranscripts: true,
		streamLiveTokens: true,
	});
	await mock.server.listen({ host: "127.0.0.1", port: 0 });
	try {
		const socket = new WebSocket(
			`${serverUrl(mock.server).replace("http", "ws")}/api/v1/realtime?token=mock-access-token`,
		);
		const received = await new Promise((resolve, reject) => {
			const messages = [];
			socket.on("message", (data) => {
				const message = JSON.parse(String(data));
				if (message.type === "proxy_ready") {
					socket.send('{"audio_format":"s16le"}');
					socket.send(Buffer.alloc(16_000));
					socket.send(Buffer.alloc(16_000));
					socket.send('{"type":"finalize"}');
					return;
				}
				messages.push(message);
				if (message.tokens?.some((token) => token.text === "<fin>")) {
					socket.close();
					resolve(messages);
				}
			});
			socket.once("error", reject);
		});
		const tokens = received.flatMap((message) => message.tokens);
		expect(received[0].tokens).toEqual([{ is_final: false, text: "Mock" }]);
		expect(received[1].tokens).toEqual([
			{ is_final: true, text: "Mock" },
			{ is_final: false, text: " transcript" },
		]);
		expect(
			tokens
				.filter((token) => token.is_final && !token.text.startsWith("<"))
				.map((token) => token.text)
				.join(""),
		).toBe("Mock transcript 1");
		expect(received.some((message) => message.finished === true)).toBe(true);
	} finally {
		for (const socket of mock.server.websocketServer?.clients ?? [])
			socket.terminate();
		mock.server.server.closeAllConnections?.();
		await mock.server.close();
	}
});

test("tags translations with their direction only when asked", async () => {
	const translate = (mock) =>
		mock.server
			.inject({
				headers: { authorization: "Bearer mock-access-token" },
				method: "GET",
				url: "/api/v1/translations?q=Привіт&sl=uk&tl=en",
			})
			.then((response) => response.json().sentences[0].trans);

	const tagged = await buildMockProxy({ tagTranslations: true });
	expect(await translate(tagged)).toBe("Привіт (uk->en)");
	await tagged.server.close();

	const plain = await buildMockProxy();
	expect(await translate(plain)).toBe("Привіт");
	await plain.server.close();
});
