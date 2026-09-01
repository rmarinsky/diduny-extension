import { expect, test } from "bun:test";
import WebSocket from "ws";
import { buildServer } from "../server";
import {
	AuthenticationError,
	FINALIZE_PROFILES,
	MemoryTokenStore,
	ProxyApiClient,
	RealtimeSession,
	SessionMachine,
	buildTranscriptionConfig,
	decodeTranscriptResult,
} from "../src/core";
import { AUDIO_FORMAT, HTTP, REALTIME } from "../src/core/constants";
import { buildMockProxy } from "../src/mock-proxy";
import { InMemorySessionStore } from "../src/server/session-store";
import { errorFromResponse } from "../web/src/errors";
import { translationResultText, translationUrl } from "../web/src/translation";

const email = "person@example.com";
const frozenPaths = [
	"POST /api/v1/auth/send-otp",
	"POST /api/v1/auth/verify-otp",
	"POST /api/v1/auth/refresh",
	"POST /api/v1/auth/logout",
	"POST /api/v1/transcriptions",
	"POST /api/v1/transcriptions/clean",
	"POST /api/v1/jobs",
	"GET /api/v1/jobs/{id}",
	"GET /api/v1/jobs/{id}/events",
	"WS /api/v1/realtime",
	"GET /api/v1/translations",
	"GET /api/v1/usage/me",
	"GET /api/v1/config",
	"GET /api/v1/models",
	"GET /api/v1/health",
];

const defaultConfig = {
	endpoints: { sttBaseURL: "mock://local", sttModel: "mock" },
	featureFlags: { realtime: true },
	messages: {},
	version: "mock",
};

function serverUrl(server) {
	const address = server.server.address();
	if (!address || typeof address === "string")
		throw new Error("Server did not bind");
	return `http://127.0.0.1:${address.port}`;
}

function sessionCookie(response) {
	const match = /diduny_session=([^;,\s]+)/.exec(
		response.headers.get("set-cookie") ?? "",
	);
	if (!match) throw new Error("BFF did not set a diduny_session cookie");
	return `diduny_session=${match[1]}`;
}

function sessionId(cookie) {
	return decodeURIComponent(cookie.slice("diduny_session=".length));
}

async function responseJson(response) {
	return response.json();
}

function uploadForm({
	audio = "source-file-audio",
	contentType = "audio/flac",
	fileName = "recording.flac",
	config = buildTranscriptionConfig({ languageHints: ["uk"] }),
} = {}) {
	const form = new FormData();
	form.append("audio", new Blob([audio], { type: contentType }), fileName);
	form.append(
		"config",
		new Blob([JSON.stringify(config)], { type: "text/plain" }),
	);
	return form;
}

function tokenSet({
	accessToken = "mock-access-token",
	email: tokenEmail = email,
	expiresAt = Date.now() + 120_000,
	refreshToken = "mock-refresh-token",
} = {}) {
	return { accessToken, email: tokenEmail, expiresAt, refreshToken };
}

function responseBytes(response) {
	return response.arrayBuffer().then((body) => new Uint8Array(body));
}

function directClient(target, initialTokens, now = () => Date.now()) {
	const store = new MemoryTokenStore(initialTokens);
	const client = new ProxyApiClient({
		clock: { now },
		http: {
			isAvailable: true,
			async send(request) {
				const response = await fetch(`${target.mockUrl}${request.path}`, {
					body: request.body,
					headers: request.headers,
					method: request.method,
				});
				return {
					body: await responseBytes(response),
					headers: Object.fromEntries(response.headers),
					status: response.status,
				};
			},
		},
		tokens: store,
	});
	return { client, store };
}

function scheduler() {
	const tasks = [];
	return {
		clearTimeout(task) {
			if (task) task.cancelled = true;
		},
		run(delay) {
			for (const task of tasks.filter(
				(candidate) => candidate.delay === delay && !candidate.cancelled,
			)) {
				task.cancelled = true;
				task.callback();
			}
		},
		setTimeout(callback, delay) {
			const task = { callback, cancelled: false, delay };
			tasks.push(task);
			return task;
		},
	};
}

function realtimeHarness() {
	const timer = scheduler();
	const completed = [];
	const errors = [];
	const sent = [];
	const updates = [];
	let handlers;
	const session = new RealtimeSession({
		connect(next) {
			handlers = next;
			return { close() {}, send: (frame) => sent.push(frame) };
		},
		onComplete: (text) => completed.push(text),
		onError: (error) => errors.push(error.code),
		onTokens: (tokens) => updates.push(...tokens),
		scheduler: timer,
	});
	return {
		completed,
		errors,
		get handlers() {
			return handlers;
		},
		sent,
		session,
		timer,
		updates,
	};
}

function parseSse(body) {
	return body
		.split("\n\n")
		.map((chunk) => {
			const lines = chunk.split("\n").filter((line) => !line.startsWith(":"));
			const event = lines.find((line) => line.startsWith("event:"));
			const data = lines.find((line) => line.startsWith("data:"));
			return event && data
				? {
						data: data.slice("data:".length).trim(),
						type: event.slice("event:".length).trim(),
					}
				: null;
		})
		.filter(Boolean);
}

function terminalSseResult(events) {
	for (const event of events) {
		if (event.type === "error") throw new Error(event.data);
		if (event.type === "completed") return JSON.parse(event.data);
	}
	throw new Error("SSE ended without a terminal event");
}

function cleanupMachine(cleanup) {
	const delivered = [];
	const machine = new SessionMachine({
		audio: {
			cancel() {},
			async start() {},
			async stop() {
				return new Uint8Array([1]);
			},
		},
		cleanup,
		deliver: (text) => delivered.push(text),
		async finalize() {
			return "raw text";
		},
		async refreshUsage() {},
		async save() {},
		async updateStored() {},
	});
	return { delivered, machine };
}

async function createTarget(mode) {
	const mock = await buildMockProxy();
	await mock.server.listen({ host: "127.0.0.1", port: 0 });
	const mockUrl = serverUrl(mock.server);
	const sessions = mode === "bff" ? new InMemorySessionStore() : null;
	const logs = [];
	const bff =
		mode === "bff"
			? await buildServer({
					log: (line) => logs.push(JSON.parse(line)),
					sessions,
					upstreamUrl: mockUrl,
				})
			: null;
	if (bff) await bff.listen({ host: "127.0.0.1", port: 0 });
	const bffUrl = bff ? serverUrl(bff) : null;
	let cookie = null;
	let id = null;
	let directSession = null;

	async function currentSession() {
		return mode === "direct" ? directSession : id ? sessions.get(id) : null;
	}

	async function auth(path, body) {
		return fetch(
			mode === "direct"
				? `${mockUrl}/api/v1/auth/${path}`
				: `${bffUrl}/bff/auth/${path}`,
			{
				body: JSON.stringify(body),
				headers: { "content-type": "application/json" },
				method: "POST",
			},
		);
	}

	async function request(path, init = {}, authenticated = true) {
		const headers = new Headers(init.headers);
		if (authenticated) {
			const session = await currentSession();
			if (mode === "direct" && session?.accessToken)
				headers.set("authorization", `Bearer ${session.accessToken}`);
			if (mode === "bff" && cookie) headers.set("cookie", cookie);
		}
		return fetch(
			mode === "direct"
				? `${mockUrl}/api/v1/${path}`
				: `${bffUrl}/bff/api/${path}`,
			{ ...init, headers },
		);
	}

	async function login({ omitUser = false } = {}) {
		mock.setOmitUser(omitUser);
		const response = await auth("verify-otp", { email, otp: "123456" });
		const body = await responseJson(response);
		mock.setOmitUser(false);
		if (!response.ok) throw new Error("Mock login failed");
		if (mode === "direct") {
			directSession = {
				accessToken: body.accessToken,
				email: body.user?.email ?? email,
				expiresAt: body.accessTokenExpiresAt,
				refreshToken: body.refreshToken,
			};
		} else {
			cookie = sessionCookie(response);
			id = sessionId(cookie);
		}
		return { body, response };
	}

	async function ensureSession() {
		const session = await currentSession();
		if (
			!session?.accessToken ||
			!session?.refreshToken ||
			typeof session.expiresAt !== "number"
		) {
			await login();
		}
	}

	async function setSession(value) {
		if (mode === "direct") {
			directSession = value;
			return;
		}
		if (!id) await login();
		await sessions.set(id, value);
	}

	async function logout() {
		const headers = new Headers();
		const session = await currentSession();
		if (mode === "direct" && session?.accessToken)
			headers.set("authorization", `Bearer ${session.accessToken}`);
		if (mode === "bff" && cookie) headers.set("cookie", cookie);
		const response = await fetch(
			mode === "direct"
				? `${mockUrl}/api/v1/auth/logout`
				: `${bffUrl}/bff/auth/logout`,
			{ headers, method: "POST" },
		);
		directSession = null;
		cookie = null;
		id = null;
		return response;
	}

	async function realtime(config) {
		await ensureSession();
		const start = mock.realtimeFrames().length;
		const url =
			mode === "direct"
				? `${mockUrl.replace("http", "ws")}/api/v1/realtime?token=${(await currentSession()).accessToken}`
				: `${bffUrl.replace("http", "ws")}/bff/realtime`;
		const headers = mode === "bff" && cookie ? { cookie } : undefined;
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(url, { headers });
			const received = [];
			const timeout = setTimeout(
				() => reject(new Error("Timed out waiting for realtime finalization")),
				2_000,
			);
			socket.on("open", () => {
				socket.send(JSON.stringify(config));
				socket.send(Buffer.from([7, 8]));
				socket.send('{"type":"finalize"}');
			});
			socket.on("message", (frame) => {
				received.push(frame.toString());
				if (frame.toString().includes("<fin>")) socket.close();
			});
			socket.on("close", () => {
				clearTimeout(timeout);
				resolve({ received, sent: mock.realtimeFrames().slice(start) });
			});
			socket.on("error", (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
	}

	async function realtimeClose() {
		await ensureSession();
		if (mode !== "bff") return null;
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(
				`${bffUrl.replace("http", "ws")}/bff/realtime`,
				{
					headers: { cookie },
				},
			);
			const timeout = setTimeout(
				() => reject(new Error("Timed out waiting for realtime close")),
				2_000,
			);
			socket.once("close", (code) => {
				clearTimeout(timeout);
				resolve(code);
			});
			socket.once("error", (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
	}

	const target = {
		auth,
		bff,
		close: async () => {
			for (const socket of mock.server.websocketServer?.clients ?? [])
				socket.terminate();
			bff?.server.closeAllConnections?.();
			mock.server.server.closeAllConnections?.();
			if (bff) await bff.close();
			await mock.server.close();
		},
		currentSession,
		ensureSession,
		login,
		logs,
		logout,
		mock,
		mockUrl,
		mode,
		request,
		reset: async () => {
			mock.clearBehaviors();
			mock.setConfig(defaultConfig);
			await ensureSession();
		},
		realtime,
		realtimeClose,
		setSession,
		sessions,
		sendOtp: (value) => auth("send-otp", { email: value }),
	};
	await target.login();
	return target;
}

const contractCases = [
	{
		id: "A1",
		endpoint: "POST /api/v1/auth/send-otp",
		run: async (target) => {
			const before = target.mock.mailbox().length;
			expect((await target.sendOtp(email)).status).toBe(204);
			expect(target.mock.mailbox().slice(before)).toEqual([
				expect.objectContaining({ email, otp: "123456" }),
			]);
		},
	},
	{
		id: "A2",
		endpoint: "POST /api/v1/auth/send-otp",
		run: async (target) => {
			const before = target.mock.mailbox().length;
			expect(
				(await target.sendOtp("not-an-email")).status,
			).toBeGreaterThanOrEqual(400);
			expect(target.mock.mailbox()).toHaveLength(before);
		},
	},
	{
		id: "A3",
		endpoint: "POST /api/v1/auth/verify-otp",
		run: async (target) => {
			const { body, response } = await target.login();
			const session = await target.currentSession();
			expect(response.ok).toBeTrue();
			expect(session).toEqual(
				expect.objectContaining({
					accessToken: expect.any(String),
					expiresAt: expect.any(Number),
					refreshToken: expect.any(String),
				}),
			);
			if (target.mode === "direct")
				expect(body.accessToken).toBe(session.accessToken);
			else expect(body).toEqual({ email });
		},
	},
	{
		id: "A4",
		endpoint: "POST /api/v1/auth/verify-otp",
		run: async (target) => {
			const response = await target.auth("verify-otp", { email, otp: "12345" });
			expect(response.ok).toBeFalse();
		},
	},
	{
		id: "A5",
		endpoint: "POST /api/v1/auth/verify-otp",
		run: async (target) => {
			await target.login();
			expect((await target.currentSession()).expiresAt).toBeGreaterThan(
				1_000_000_000_000,
			);
		},
	},
	{
		id: "A6",
		endpoint: "POST /api/v1/auth/verify-otp",
		run: async (target) => {
			const { body } = await target.login({ omitUser: true });
			expect((await target.currentSession()).email).toBe(email);
			if (target.mode === "direct") expect(body.user).toBeUndefined();
		},
	},
	{
		id: "A7",
		endpoint: "POST /api/v1/auth/refresh",
		run: async (target) => {
			if (target.mode === "direct") {
				await target.login();
				const initial = await target.currentSession();
				const { client, store } = directClient(
					target,
					{
						...initial,
						expiresAt: 1,
					},
					() => 0,
				);
				await client.usage();
				expect((await store.read()).refreshToken).not.toBe(
					initial.refreshToken,
				);
			} else {
				const initial = await target.currentSession();
				await target.setSession({ ...initial, expiresAt: Date.now() + 1 });
				expect((await target.request("usage/me")).ok).toBeTrue();
				expect((await target.currentSession()).refreshToken).not.toBe(
					initial.refreshToken,
				);
			}
		},
	},
	{
		id: "A8",
		endpoint: "POST /api/v1/auth/refresh",
		run: async (target) => {
			target.mock.setBehavior("/api/v1/auth/refresh", "malformed");
			if (target.mode === "direct") {
				await target.login();
				const { client, store } = directClient(
					target,
					{
						...(await target.currentSession()),
						expiresAt: 1,
					},
					() => 0,
				);
				await expect(client.usage()).rejects.toThrow("Invalid token response");
				expect(await store.read()).toBeNull();
			} else {
				await target.setSession({
					...(await target.currentSession()),
					expiresAt: Date.now() + 1,
				});
				expect((await target.request("usage/me")).status).toBe(401);
				expect(await target.currentSession()).toBeNull();
			}
		},
	},
	{
		id: "A9",
		endpoint: "POST /api/v1/auth/refresh",
		run: async (target) => {
			if (target.mode === "direct") {
				const { client, store } = directClient(target, null, () => 0);
				await expect(client.usage()).rejects.toBeInstanceOf(
					AuthenticationError,
				);
				expect(await store.read()).toBeNull();
			} else {
				await target.setSession({
					accessToken: "mock-access-token",
					expiresAt: Date.now() + 1,
				});
				expect((await target.request("usage/me")).status).toBe(401);
				expect(await target.currentSession()).toBeNull();
			}
		},
	},
	{
		id: "A10",
		endpoint: "POST /api/v1/auth/refresh",
		run: async (target) => {
			for (const missing of [
				"accessToken",
				"email",
				"expiresAt",
				"refreshToken",
			]) {
				const partial = { ...tokenSet(), [missing]: undefined };
				const { client, store } = directClient(target, partial, () => 0);
				await expect(client.usage()).rejects.toBeInstanceOf(
					AuthenticationError,
				);
				expect(await store.read()).toBeNull();
			}
		},
	},
	{
		id: "A11",
		endpoint: "POST /api/v1/auth/logout",
		run: async (target) => {
			await target.login();
			target.mock.setBehavior("/api/v1/auth/logout", "unauthorized");
			await target.logout();
			expect(await target.currentSession()).toBeNull();
		},
	},
	{
		id: "A12",
		endpoint: "POST /api/v1/auth/logout",
		run: async (target) => {
			let beginRefresh;
			const started = new Promise((resolve) => {
				beginRefresh = resolve;
			});
			let finishRefresh;
			const refresh = new Promise((resolve) => {
				finishRefresh = resolve;
			});
			const store = new MemoryTokenStore({ ...tokenSet(), expiresAt: 1 });
			const client = new ProxyApiClient({
				clock: { now: () => 0 },
				http: {
					isAvailable: true,
					async send(request) {
						if (request.path === "/api/v1/auth/refresh") {
							beginRefresh();
							return refresh;
						}
						return {
							body: new TextEncoder().encode(
								JSON.stringify({
									isWhitelisted: true,
									usedHours: 0,
									usedMs: 0,
								}),
							),
							headers: {},
							status: 200,
						};
					},
				},
				tokens: store,
			});
			const request = client.usage();
			await started;
			const logout = client.logout();
			finishRefresh({
				body: new TextEncoder().encode(
					JSON.stringify({
						accessToken: "fresh",
						accessTokenExpiresAt: 120_000,
						refreshToken: "fresh-refresh",
					}),
				),
				headers: {},
				status: 200,
			});
			await Promise.all([request, logout]);
			expect(await store.read()).toBeNull();
		},
	},
	{
		id: "B1",
		endpoint: "POST /api/v1/auth/refresh",
		run: async (target) => {
			const before = target.mock.authRefreshes().length;
			if (target.mode === "direct") {
				await target.login();
				const { client } = directClient(
					target,
					{
						...(await target.currentSession()),
						expiresAt: HTTP.proactiveRefreshLeadMs + 1,
					},
					() => 0,
				);
				await client.usage();
			} else {
				await target.setSession({
					...(await target.currentSession()),
					expiresAt: Date.now() + HTTP.proactiveRefreshLeadMs + 1_000,
				});
				await target.request("usage/me");
			}
			expect(target.mock.authRefreshes()).toHaveLength(before);
		},
	},
	{
		id: "B2",
		endpoint: "POST /api/v1/auth/refresh",
		run: async (target) => {
			const before = target.mock.authRefreshes().length;
			if (target.mode === "direct") {
				await target.login();
				const { client } = directClient(
					target,
					{
						...(await target.currentSession()),
						expiresAt: HTTP.proactiveRefreshLeadMs,
					},
					() => 0,
				);
				await client.usage();
			} else {
				await target.setSession({
					...(await target.currentSession()),
					expiresAt: Date.now() + 1,
				});
				await target.request("usage/me");
			}
			expect(target.mock.authRefreshes()).toHaveLength(before + 1);
		},
	},
	{
		id: "B3",
		endpoint: "POST /api/v1/auth/refresh",
		run: async (target) => {
			const before = target.mock.authRefreshes().length;
			if (target.mode === "direct") {
				await target.login();
				const initial = await target.currentSession();
				const { client } = directClient(
					target,
					{ ...initial, accessToken: "stale" },
					() => 0,
				);
				await Promise.all(Array.from({ length: 10 }, () => client.usage()));
			} else {
				const current = await target.currentSession();
				await target.setSession({
					...current,
					accessToken: "stale",
					expiresAt: Date.now() + 120_000,
				});
				const responses = await Promise.all(
					Array.from({ length: 10 }, () => target.request("usage/me")),
				);
				expect(responses.every((response) => response.ok)).toBeTrue();
			}
			expect(target.mock.authRefreshes()).toHaveLength(before + 1);
		},
	},
	{
		id: "B4",
		endpoint: "POST /api/v1/auth/refresh",
		run: async (target) => {
			const before = target.mock.authRefreshes().length;
			if (target.mode === "direct") {
				await target.login();
				const initial = await target.currentSession();
				const { client } = directClient(target, {
					...initial,
					accessToken: "stale",
				});
				expect((await client.usage()).isWhitelisted).toBeTrue();
			} else {
				const current = await target.currentSession();
				await target.setSession({
					...current,
					accessToken: "stale",
					expiresAt: Date.now() + 120_000,
				});
				expect((await target.request("usage/me")).ok).toBeTrue();
			}
			expect(target.mock.authRefreshes()).toHaveLength(before + 1);
		},
	},
	{
		id: "B5",
		endpoint: "POST /api/v1/auth/refresh",
		run: async (target) => {
			const before = target.mock.authRefreshes().length;
			target.mock.setBehaviorSequence("/api/v1/usage/me", [
				"unauthorized",
				"unauthorized",
			]);
			if (target.mode === "direct") {
				await target.login();
				const { client } = directClient(target, await target.currentSession());
				await expect(client.usage()).rejects.toBeInstanceOf(
					AuthenticationError,
				);
			} else {
				expect((await target.request("usage/me")).status).toBe(401);
			}
			expect(target.mock.authRefreshes()).toHaveLength(before + 1);
		},
	},
	{
		id: "B6",
		endpoint: "POST /api/v1/transcriptions",
		run: async (target) => {
			target.mock.setBehaviorSequence("/api/v1/transcriptions", [
				"unauthorized",
				null,
			]);
			const first = await target.request("transcriptions", {
				body: uploadForm(),
				method: "POST",
				redirect: "manual",
			});
			if (target.mode === "bff") {
				expect(first.status).toBe(307);
				const retry = await target.request("transcriptions?__diduny_retry=1", {
					body: uploadForm(),
					method: "POST",
				});
				expect(retry.ok).toBeTrue();
			} else {
				expect(first.status).toBe(401);
				expect(
					(
						await target.request("transcriptions", {
							body: uploadForm(),
							method: "POST",
						})
					).ok,
				).toBeTrue();
			}
			const upload = target.mock.uploads().at(-1);
			expect(upload.body).toContain("source-file-audio");
		},
	},
	{
		id: "B7",
		endpoint: "GET /api/v1/usage/me",
		run: async (target) => {
			if (target.mode === "direct") {
				target.mock.setBehavior("/api/v1/usage/me", "quota");
				const { client } = directClient(target, await target.currentSession());
				await expect(client.usage()).rejects.toEqual(
					expect.objectContaining({ limitHours: 2, usedHours: 2 }),
				);
			} else {
				target.mock.setBehavior("/api/v1/usage/me", "quota");
				const response = await target.request("usage/me");
				expect(
					errorFromResponse(response.status, await responseJson(response)),
				).toEqual(expect.objectContaining({ code: "quota_exhausted" }));
			}
		},
	},
	{
		id: "B8",
		endpoint: "GET /api/v1/usage/me",
		run: async () => {
			const error = errorFromResponse(402, { malformed: true });
			expect(error).toEqual(
				expect.objectContaining({
					code: "quota_exhausted",
					details: { limitHours: undefined, status: 402, usedHours: undefined },
				}),
			);
		},
	},
	{
		id: "C1",
		endpoint: "POST /api/v1/transcriptions",
		run: async (target) => {
			expect(
				(
					await target.request("transcriptions", {
						body: uploadForm(),
						method: "POST",
					})
				).ok,
			).toBeTrue();
			const body = target.mock.transcriptions().at(-1).body;
			expect(body.match(/Content-Disposition/g) ?? []).toHaveLength(2);
			expect(body.indexOf('name="audio"')).toBeLessThan(
				body.indexOf('name="config"'),
			);
		},
	},
	{
		id: "C2",
		endpoint: "POST /api/v1/transcriptions",
		run: async (target) => {
			await target.request("transcriptions", {
				body: uploadForm(),
				method: "POST",
			});
			const body = target.mock.transcriptions().at(-1).body;
			const configPart = body.slice(body.indexOf('name="config"'));
			expect(configPart).toContain("Content-Type: text/plain");
			expect(configPart).toContain('"language_hints"');
		},
	},
	{
		id: "C3",
		endpoint: "POST /api/v1/transcriptions",
		run: async (target) => {
			await target.request("transcriptions", {
				body: uploadForm({
					contentType: "audio/webm",
					fileName: "detected.webm",
				}),
				method: "POST",
			});
			const body = target.mock.transcriptions().at(-1).body;
			expect(body).toContain('filename="detected.webm"');
			expect(body).toContain("Content-Type: audio/webm");
		},
	},
	{
		id: "C4",
		endpoint: "POST /api/v1/transcriptions",
		run: async (target) => {
			expect(AUDIO_FORMAT).toMatchObject({ channels: 1, sampleRate: 16000 });
			await target.request("transcriptions", {
				body: uploadForm(),
				method: "POST",
			});
			expect(target.mock.transcriptions().at(-1).body).toContain(
				"Content-Type: audio/flac",
			);
		},
	},
	{
		id: "C5",
		endpoint: "POST /api/v1/transcriptions",
		run: async () => {
			expect(
				buildTranscriptionConfig({
					enableSpeakerDiarization: true,
					languageHints: ["uk"],
				}),
			).toEqual({
				enable_speaker_diarization: true,
				language_hints: ["uk"],
				language_hints_strict: true,
				mode: "transcribe",
			});
		},
	},
	{
		id: "C6",
		endpoint: "POST /api/v1/transcriptions",
		run: async () => {
			expect(
				buildTranscriptionConfig({ languageHints: ["uk"] })
					.language_hints_strict,
			).toBeTrue();
		},
	},
	{
		id: "C7",
		endpoint: "POST /api/v1/transcriptions",
		run: async () => {
			expect(
				buildTranscriptionConfig({ languageHints: [] }),
			).not.toHaveProperty("language_hints");
		},
	},
	{
		id: "C8",
		endpoint: "POST /api/v1/transcriptions",
		run: async () => {
			expect(
				buildTranscriptionConfig({ translation: { targetLanguage: "en" } }),
			).toMatchObject({
				mode: "translate",
				translation: { target_language: "en", type: "one_way" },
			});
		},
	},
	{
		id: "C9",
		endpoint: "POST /api/v1/transcriptions",
		run: async () => {
			expect(
				buildTranscriptionConfig({
					translation: { languageA: "uk", languageB: "en", type: "two_way" },
				}),
			).toMatchObject({
				mode: "translate",
				translation: { language_a: "uk", language_b: "en", type: "two_way" },
			});
		},
	},
	{
		id: "C10",
		endpoint: "POST /api/v1/transcriptions",
		run: async (target) => {
			const response = await target.request("transcriptions", {
				body: uploadForm(),
				method: "POST",
			});
			const result = decodeTranscriptResult(await responseJson(response));
			expect(result).toEqual({
				text: "Mock transcript",
				tokens: [
					{ endMs: 480, speaker: "1", startMs: 0, text: "Mock transcript" },
				],
			});
		},
	},
	{
		id: "D1",
		endpoint: "POST /api/v1/transcriptions/clean",
		run: async (target) => {
			const response = await target.request("transcriptions/clean", {
				body: JSON.stringify({ text: "raw" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
			expect(await responseJson(response)).toEqual({ text: "raw" });
		},
	},
	{
		id: "D2",
		endpoint: "POST /api/v1/transcriptions/clean",
		run: async (target) => {
			target.mock.setBehavior("/api/v1/transcriptions/clean", "unauthorized");
			expect(
				(
					await target.request("transcriptions/clean", {
						body: "{}",
						headers: { "content-type": "application/json" },
						method: "POST",
					})
				).ok,
			).toBeFalse();
			const { delivered, machine } = cleanupMachine(async () => {
				throw new Error("cleanup failed");
			});
			await machine.start();
			await machine.stop();
			await machine.waitForBackground();
			expect(delivered).toEqual(["raw text"]);
		},
	},
	{
		id: "D3",
		endpoint: "POST /api/v1/transcriptions/clean",
		run: async () => {
			const { delivered, machine } = cleanupMachine(
				() => new Promise(() => {}),
			);
			await machine.start();
			await machine.stop();
			expect(delivered).toEqual(["raw text"]);
		},
	},
	{
		id: "E1",
		endpoint: "POST /api/v1/jobs",
		run: async (target) => {
			expect(
				(await target.request("jobs", { body: uploadForm(), method: "POST" }))
					.ok,
			).toBeTrue();
			const body = target.mock.uploads().at(-1).body;
			expect(body.indexOf('name="audio"')).toBeLessThan(
				body.indexOf('name="config"'),
			);
		},
	},
	{
		id: "E2",
		endpoint: "POST /api/v1/jobs",
		run: async (target) => {
			const source = "disk-backed-source";
			await target.request("jobs", {
				body: uploadForm({ audio: source }),
				method: "POST",
			});
			expect(target.mock.uploads().at(-1)).toEqual(
				expect.objectContaining({
					body: expect.stringContaining(source),
					bytes: expect.any(Number),
				}),
			);
		},
	},
	{
		id: "E3",
		endpoint: "POST /api/v1/jobs",
		run: async (target) => {
			const response = await target.request("jobs", {
				body: uploadForm(),
				method: "POST",
			});
			expect(await responseJson(response)).toEqual({
				createdAt: expect.any(String),
				jobId: "mock-job",
				status: "queued",
			});
		},
	},
	{
		id: "E4",
		endpoint: "GET /api/v1/jobs/{id}/events",
		run: async (target) => {
			target.mock.setSseBody(
				'event: status\ndata: processing\n\nevent: completed\ndata: {"text":"done","tokens":[]}\n\n',
			);
			const response = await target.request("jobs/mock-job/events");
			expect(
				parseSse(await response.text()).map((event) => event.type),
			).toEqual(["status", "completed"]);
		},
	},
	{
		id: "E5",
		endpoint: "GET /api/v1/jobs/{id}/events",
		run: async (target) => {
			const response = await target.request("jobs/mock-job/events");
			expect(
				decodeTranscriptResult(
					terminalSseResult(parseSse(await response.text())),
				).text,
			).toBe("Mock transcript");
		},
	},
	{
		id: "E6",
		endpoint: "GET /api/v1/jobs/{id}/events",
		run: async (target) => {
			target.mock.setSseBody("event: error\ndata: upstream failed\n\n");
			const response = await target.request("jobs/mock-job/events");
			const events = parseSse(await response.text());
			expect(() => terminalSseResult(events)).toThrow("upstream failed");
		},
	},
	{
		id: "E7",
		endpoint: "GET /api/v1/jobs/{id}/events",
		run: async (target) => {
			target.mock.setSseBody(
				': heartbeat\n\nevent: completed\ndata: {"text":"done","tokens":[]}\n\n',
			);
			const response = await target.request("jobs/mock-job/events");
			expect(parseSse(await response.text())).toEqual([
				{ data: '{"text":"done","tokens":[]}', type: "completed" },
			]);
		},
	},
	{
		id: "E8",
		endpoint: "GET /api/v1/jobs/{id}/events",
		run: async (target) => {
			target.mock.setSseBody("event: status\ndata: processing\n\n");
			const response = await target.request("jobs/mock-job/events");
			const events = parseSse(await response.text());
			expect(() => terminalSseResult(events)).toThrow(
				"without a terminal event",
			);
		},
	},
	{
		id: "E9",
		endpoint: "GET /api/v1/jobs/{id}",
		run: async (target) => {
			const response = await target.request("jobs/mock-job");
			expect(await responseJson(response)).toEqual({
				id: "mock-job",
				status: "completed",
			});
		},
	},
	{
		id: "E10",
		endpoint: "GET /api/v1/jobs/{id}/events",
		run: async () => {
			const timings = [
				{ end_ms: 200, start_ms: 100 },
				{ endMs: 200, startMs: 100 },
				{ end_seconds: 0.2, start_seconds: 0.1 },
				{ endSeconds: 0.2, startSeconds: 0.1 },
				{ end: 0.2, start: 0.1 },
			];
			for (const textKey of ["text", "transcript"])
				for (const tokenKey of ["tokens", "words", "segments"])
					for (const timing of timings)
						for (const speakerKey of [
							"speaker",
							"speaker_id",
							"speaker_index",
						]) {
							const result = decodeTranscriptResult({
								[textKey]: "tolerant",
								[tokenKey]: [{ ...timing, [speakerKey]: 2, text: "token" }],
							});
							expect(result).toEqual({
								text: "tolerant",
								tokens: [
									{ endMs: 200, speaker: "2", startMs: 100, text: "token" },
								],
							});
						}
		},
	},
	{
		id: "F1",
		endpoint: "WS /api/v1/realtime",
		run: async (target) => {
			const { sent } = await target.realtime({
				audio_format: "s16le",
				num_channels: 1,
				sample_rate: 16000,
			});
			expect(JSON.parse(sent[0].data)).toEqual({
				audio_format: "s16le",
				num_channels: 1,
				sample_rate: 16000,
			});
		},
	},
	{
		id: "F2",
		endpoint: "WS /api/v1/realtime",
		run: async (target) => {
			const config = {
				audio_format: "s16le",
				...buildTranscriptionConfig({ languageHints: ["uk"] }),
			};
			const { sent } = await target.realtime(config);
			expect(JSON.parse(sent[0].data).language_hints_strict).toBeTrue();
		},
	},
	{
		id: "F3",
		endpoint: "WS /api/v1/realtime",
		run: async (target) => {
			const { sent } = await target.realtime({ audio_format: "s16le" });
			expect(sent[1]).toEqual({ data: Buffer.from([7, 8]), isBinary: true });
		},
	},
	{
		id: "F4",
		endpoint: "WS /api/v1/realtime",
		run: async (target) => {
			const { received } = await target.realtime({ audio_format: "s16le" });
			expect(received.join("\n")).toContain("proxy_ready");
		},
	},
	{
		id: "F5",
		endpoint: "WS /api/v1/realtime",
		run: async () => {
			const harness = realtimeHarness();
			harness.session.start();
			harness.timer.run(REALTIME.readyWatchdogMs);
			expect(harness.errors).toEqual(["realtime_ready_timeout"]);
		},
	},
	{
		id: "F6",
		endpoint: "WS /api/v1/realtime",
		run: async () => {
			const harness = realtimeHarness();
			harness.session.start();
			harness.handlers.message('{"error":"rejected"}');
			harness.timer.run(REALTIME.readyWatchdogMs);
			expect(harness.errors).toEqual(["realtime_rejected"]);
		},
	},
	{
		id: "F7",
		endpoint: "WS /api/v1/realtime",
		run: async () => {
			const harness = realtimeHarness();
			harness.session.start();
			harness.handlers.message('{"type":"proxy_ready"}');
			harness.handlers.message('{"type":"proxy_ready"}');
			harness.session.close();
			harness.timer.run(REALTIME.readyWatchdogMs);
			expect(harness.errors).toEqual([]);
		},
	},
	{
		id: "F8",
		endpoint: "WS /api/v1/realtime",
		run: async () => {
			const harness = realtimeHarness();
			harness.session.start();
			harness.session.sendAudio(new Uint8Array([1]));
			harness.session.sendAudio(new Uint8Array([2]));
			harness.handlers.message('{"type":"proxy_ready"}');
			expect(harness.sent).toEqual([new Uint8Array([1]), new Uint8Array([2])]);
		},
	},
	{
		id: "F9",
		endpoint: "WS /api/v1/realtime",
		run: async () => {
			const harness = realtimeHarness();
			let queued = false;
			const originalSend = harness.sent.push.bind(harness.sent);
			harness.sent.push = (frame) => {
				originalSend(frame);
				if (!queued) {
					queued = true;
					harness.session.sendAudio(new Uint8Array([3]));
				}
				return harness.sent.length;
			};
			harness.session.start();
			harness.session.sendAudio(new Uint8Array([1]));
			harness.session.sendAudio(new Uint8Array([2]));
			harness.handlers.message('{"type":"proxy_ready"}');
			expect(harness.sent).toEqual([
				new Uint8Array([1]),
				new Uint8Array([2]),
				new Uint8Array([3]),
			]);
		},
	},
	{
		id: "F10",
		endpoint: "WS /api/v1/realtime",
		run: async (target) => {
			const relay = await target.realtime({ audio_format: "s16le" });
			expect(relay.received.join("\n")).toContain("<end>");
			const harness = realtimeHarness();
			harness.session.start();
			harness.handlers.message(
				'{"tokens":[{"is_final":true,"text":"visible<end>"},{"is_final":true,"text":"<fin>"}]}',
			);
			harness.timer.run(100);
			expect(harness.updates).toEqual([{ isFinal: true, text: "visible" }]);
		},
	},
	{
		id: "F11",
		endpoint: "WS /api/v1/realtime",
		run: async () => {
			const harness = realtimeHarness();
			harness.session.start();
			harness.handlers.message('{"type":"proxy_ready"}');
			harness.handlers.message(
				'{"tokens":[{"is_final":true,"text":"first"},{"is_final":true,"text":"<end>"},{"is_final":true,"text":"second"}]}',
			);
			harness.timer.run(100);
			expect(harness.updates.map((token) => token.text)).toEqual([
				"first",
				"second",
			]);
		},
	},
	{
		id: "F12",
		endpoint: "WS /api/v1/realtime",
		run: async () => {
			const harness = realtimeHarness();
			harness.session.start();
			harness.handlers.message('{"type":"proxy_ready"}');
			harness.session.finalize();
			expect(harness.sent).toEqual(['{"type":"finalize"}']);
			harness.timer.run(FINALIZE_PROFILES.dictationFast.controlMessageDelayMs);
			expect(harness.sent.at(-1)).toEqual(new Uint8Array());
		},
	},
	{
		id: "F13",
		endpoint: "WS /api/v1/realtime",
		run: async () => {
			const harness = realtimeHarness();
			harness.session.start();
			harness.handlers.close({ code: 1011 });
			harness.timer.run(REALTIME.reconnectBackoffMs);
			expect(harness.errors).toEqual([]);
		},
	},
	{
		id: "F14",
		endpoint: "WS /api/v1/realtime",
		run: async (target) => {
			if (target.mode === "bff") {
				target.mock.setBehavior("/api/v1/usage/me", "quota");
				const url = `${serverUrl(target.bff).replace("http", "ws")}/bff/realtime`;
				const session = await target.currentSession();
				const socket = new WebSocket(url, {
					headers: {
						cookie: `diduny_session=${await target.sessions.create(session)}`,
					},
				});
				const [code] = await new Promise((resolve, reject) => {
					socket.once("close", (...values) => resolve(values));
					socket.once("error", reject);
				});
				expect(code).toBe(4002);
			} else {
				const harness = realtimeHarness();
				harness.session.start();
				harness.handlers.close({ code: REALTIME.quotaCloseCode });
				expect(harness.errors).toEqual(["quota_exhausted"]);
			}
		},
	},
	{
		id: "G1",
		endpoint: "GET /api/v1/translations",
		run: async (target) => {
			const url = new URL(
				translationUrl("Привіт", {
					sourceLanguage: "uk",
					targetLanguage: "en",
				}),
				"https://diduny.test",
			);
			expect(Object.fromEntries(url.searchParams)).toEqual({
				q: "Привіт",
				sl: "uk",
				tl: "en",
			});
			expect(
				(await target.request(`translations?${url.searchParams}`)).ok,
			).toBeTrue();
		},
	},
	{
		id: "G2",
		endpoint: "GET /api/v1/translations",
		run: async () => {
			const url = translationUrl("a&b = c", {
				sourceLanguage: "uk",
				targetLanguage: "en",
			});
			expect(new URL(url, "https://diduny.test").searchParams.get("q")).toBe(
				"a&b = c",
			);
		},
	},
	{
		id: "G3",
		endpoint: "GET /api/v1/translations",
		run: async () => {
			expect(
				translationResultText({
					sentences: [{ trans: " first" }, { trans: " second " }],
				}),
			).toBe("first second");
		},
	},
	{
		id: "G4",
		endpoint: "GET /api/v1/translations",
		run: async () => {
			expect(() => translationResultText({ sentences: [] })).toThrow(
				"empty_result",
			);
		},
	},
	{
		id: "G5",
		endpoint: "GET /api/v1/translations",
		run: async (target) => {
			target.mock.setBehavior("/api/v1/translations", "server_error");
			const response = await target.request("translations?q=x&sl=uk&tl=en");
			const body = await responseJson(response);
			expect(errorFromResponse(response.status, body)).toEqual(
				expect.objectContaining({
					code: "request_rejected",
					details: { body, status: 500 },
				}),
			);
		},
	},
	{
		id: "H1",
		endpoint: "GET /api/v1/usage/me",
		run: async (target) => {
			expect(await responseJson(await target.request("usage/me"))).toEqual({
				isWhitelisted: true,
				usedHours: 0,
				usedMs: 0,
			});
		},
	},
	{
		id: "H2",
		endpoint: "GET /api/v1/usage/me",
		run: async (target) => {
			const usage = await responseJson(await target.request("usage/me"));
			expect(usage.limitHours).toBeUndefined();
			expect(usage.isWhitelisted).toBeTrue();
		},
	},
	{
		id: "H3",
		endpoint: "GET /api/v1/usage/me",
		run: async (target) => {
			const { client } = directClient(target, await target.currentSession());
			const cached = await client.refreshUsage();
			target.mock.setBehavior("/api/v1/usage/me", "server_error");
			expect((await target.request("usage/me")).status).toBe(500);
			expect(await client.refreshUsage()).toEqual(cached);
		},
	},
	{
		id: "H4",
		endpoint: "GET /api/v1/usage/me",
		run: async (target) => {
			const { client } = directClient(target, await target.currentSession());
			const cached = await client.refreshUsage();
			target.mock.setBehavior("/api/v1/usage/me", "malformed");
			expect(await responseJson(await target.request("usage/me"))).toEqual({
				malformed: true,
			});
			expect(await client.refreshUsage()).toEqual(cached);
		},
	},
	{
		id: "I1",
		endpoint: "GET /api/v1/config",
		run: async (target) => {
			expect(
				await responseJson(await target.request("config", {}, false)),
			).toEqual(defaultConfig);
		},
	},
	{
		id: "I2",
		endpoint: "GET /api/v1/config",
		run: async (target) => {
			target.mock.setConfig({
				...defaultConfig,
				featureFlags: { realtime: false },
			});
			expect(
				(await responseJson(await target.request("config", {}, false)))
					.featureFlags.realtime,
			).toBeFalse();
			if (target.mode === "bff")
				expect(await target.realtimeClose()).toBe(1011);
		},
	},
	{
		id: "I3",
		endpoint: "GET /api/v1/config",
		run: async (target) => {
			const first = await responseJson(
				await target.request("config", {}, false),
			);
			if (target.mode === "bff")
				await target.realtime({ audio_format: "s16le" });
			target.mock.setConfig({
				...defaultConfig,
				featureFlags: { realtime: false },
				version: "changed",
			});
			const second = await responseJson(
				await target.request("config", {}, false),
			);
			expect([first.version, second.version]).toEqual(["mock", "changed"]);
			if (target.mode === "bff") {
				expect(await target.realtimeClose()).toBe(1011);
				expect(target.logs).toContainEqual(
					expect.objectContaining({
						event: "proxy.realtime_config_changed",
						realtimeEnabled: false,
					}),
				);
			}
		},
	},
	{
		id: "J1",
		endpoint: "GET /api/v1/models",
		run: async (target) => {
			expect((await target.request("models")).ok).toBeTrue();
		},
	},
	{
		id: "J2",
		endpoint: "GET /api/v1/models",
		run: async (target) => {
			const response = await target.request("models", {}, false);
			expect([401, 403]).toContain(response.status);
			expect(
				errorFromResponse(response.status, await responseJson(response)),
			).toEqual(expect.objectContaining({ code: "authentication_failed" }));
		},
	},
	{
		id: "J3",
		endpoint: "GET /api/v1/health",
		run: async (target) => {
			expect((await target.request("health", {}, false)).status).toBe(204);
		},
	},
];

test("frozen contract table contains all 72 cases and covers every frozen path", () => {
	expect(contractCases).toHaveLength(72);
	expect(
		[
			...new Set(contractCases.map((contractCase) => contractCase.endpoint)),
		].sort(),
	).toEqual([...new Set(frozenPaths)].sort());
});

for (const mode of ["direct", "bff"]) {
	test(`runs all frozen contract cases against the local mock ${mode}`, async () => {
		const target = await createTarget(mode);
		try {
			for (const contractCase of contractCases) {
				await target.reset();
				try {
					await contractCase.run(target);
				} catch (error) {
					throw new Error(
						`[${mode}] ${contractCase.id} ${contractCase.endpoint}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				}
			}
		} finally {
			await target.close();
		}
	}, 30_000);
}
