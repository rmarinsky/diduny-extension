import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";

export type MockProxyBehavior =
	| "hang"
	| "malformed"
	| "quota"
	| "server_error"
	| "unauthorized";

export interface MockMailboxMessage {
	email: string;
	otp: string;
}

export interface MockProxyOptions {
	accessToken?: string;
	refreshToken?: string;
}

export interface MockTranscription {
	authorization?: string;
	body: string;
	bytes: number;
	contentType?: string;
}

export interface MockUpload extends MockTranscription {
	endpoint: "jobs" | "transcriptions";
}

export interface MockProxyConfig {
	endpoints: { sttBaseURL: string; sttModel: string };
	featureFlags: Record<string, boolean>;
	messages: Record<string, string>;
	version: string;
}

export interface MockRealtimeFrame {
	data: Buffer | string;
	isBinary: boolean;
}

const defaultSseBody =
	': mock keepalive\n\nevent: status\ndata: processing\n\nevent: completed\ndata: {"text":"Mock transcript","tokens":[]}\n\n';
const defaultConfig: MockProxyConfig = {
	endpoints: { sttBaseURL: "mock://local", sttModel: "mock" },
	featureFlags: { realtime: true },
	messages: {},
	version: "mock",
};

function requestPath(url: string | undefined) {
	return new URL(url ?? "", "http://mock.local").pathname;
}

function requireBearer(
	request: { headers: { authorization?: string } },
	reply: FastifyReply,
	accessToken: string,
) {
	if (request.headers.authorization === `Bearer ${accessToken}`) return true;
	reply.code(401).send({ error: "unauthorized" });
	return false;
}

async function capturedBody(value: unknown) {
	if (!value || typeof value !== "object" || !(Symbol.asyncIterator in value)) {
		return { body: "", bytes: 0 };
	}
	const chunks: Buffer[] = [];
	for await (const chunk of value as AsyncIterable<Uint8Array | string>) {
		chunks.push(Buffer.from(chunk));
	}
	const body = Buffer.concat(chunks);
	return { body: body.toString(), bytes: body.byteLength };
}

export async function buildMockProxy({
	accessToken = "mock-access-token",
	refreshToken: configuredRefreshToken = "mock-refresh-token",
}: MockProxyOptions = {}) {
	const server = Fastify({ logger: false });
	const mailbox: MockMailboxMessage[] = [];
	const behaviors = new Map<string, MockProxyBehavior>();
	const behaviorSequences = new Map<string, Array<MockProxyBehavior | null>>();
	const refreshes: string[] = [];
	const transcriptions: MockTranscription[] = [];
	const uploads: MockUpload[] = [];
	const realtimeFrames: MockRealtimeFrame[] = [];
	let currentRefreshToken = configuredRefreshToken;
	let refreshVersion = 0;
	let config = structuredClone(defaultConfig);
	let omitUser = false;
	let sseBody = defaultSseBody;
	await server.register(websocket);
	server.addContentTypeParser(
		/^multipart\/form-data/i,
		(_request, payload, done) => done(null, payload),
	);
	server.addHook("preHandler", (request, reply, done) => {
		const path = requestPath(request.raw.url);
		const sequence = behaviorSequences.get(path);
		const behavior = sequence?.length ? sequence.shift() : behaviors.get(path);
		if (sequence?.length === 0) behaviorSequences.delete(path);
		if (!behavior) return done();
		if (behavior === "unauthorized") {
			reply.code(401).send({ error: "unauthorized" });
			return;
		}
		if (behavior === "quota") {
			reply.code(402).send({ limitHours: 2, usedHours: 2 });
			return;
		}
		if (behavior === "malformed") {
			reply.send({ malformed: true });
			return;
		}
		if (behavior === "server_error") {
			reply.code(500).send({ error: "upstream_failed" });
			return;
		}
		// Intentionally leave the request unresolved so callers can exercise timeout handling.
	});

	server.post("/api/v1/auth/send-otp", async (request, reply) => {
		const email = (request.body as { email?: unknown } | undefined)?.email;
		if (typeof email !== "string" || !email.includes("@"))
			return reply.code(400).send({ error: "invalid_email" });
		mailbox.push({ email, otp: "123456" });
		return reply.code(204).send();
	});
	server.post("/api/v1/auth/verify-otp", async (request, reply) => {
		const payload = request.body as
			| { email?: unknown; otp?: unknown }
			| undefined;
		if (typeof payload?.email !== "string" || payload.otp !== "123456")
			return reply.code(401).send({ error: "invalid_otp" });
		return {
			accessToken,
			accessTokenExpiresAt: Date.now() + 300_000,
			refreshToken: currentRefreshToken,
			...(omitUser ? {} : { user: { email: payload.email } }),
		};
	});
	server.post("/api/v1/auth/refresh", async (request, reply) => {
		const refreshToken = (
			request.body as { refreshToken?: unknown } | undefined
		)?.refreshToken;
		if (refreshToken !== currentRefreshToken)
			return reply.code(401).send({ error: "invalid_refresh_token" });
		refreshes.push(refreshToken);
		currentRefreshToken = `${configuredRefreshToken}-${++refreshVersion}`;
		return {
			accessToken,
			accessTokenExpiresAt: Date.now() + 300_000,
			refreshToken: currentRefreshToken,
		};
	});
	server.post("/api/v1/auth/logout", async (request, reply) => {
		if (!requireBearer(request, reply, accessToken)) return;
		return reply.code(204).send();
	});

	server.post("/api/v1/transcriptions", async (request, reply) => {
		if (!requireBearer(request, reply, accessToken)) return;
		const body = await capturedBody(request.body);
		const upload = {
			authorization: request.headers.authorization,
			contentType: request.headers["content-type"],
			endpoint: "transcriptions" as const,
			...body,
		};
		uploads.push(upload);
		transcriptions.push(upload);
		return {
			text: "Mock transcript",
			tokens: [
				{
					end_ms: 480,
					speaker: "1",
					start_ms: 0,
					text: "Mock transcript",
				},
			],
		};
	});
	server.post("/api/v1/transcriptions/clean", async (request, reply) => {
		if (!requireBearer(request, reply, accessToken)) return;
		const text = (request.body as { text?: unknown } | undefined)?.text;
		return { text: typeof text === "string" ? text : "" };
	});
	server.post("/api/v1/jobs", async (request, reply) => {
		if (!requireBearer(request, reply, accessToken)) return;
		uploads.push({
			authorization: request.headers.authorization,
			contentType: request.headers["content-type"],
			endpoint: "jobs",
			...(await capturedBody(request.body)),
		});
		return {
			createdAt: new Date().toISOString(),
			jobId: "mock-job",
			status: "queued",
		};
	});
	server.get("/api/v1/jobs/:id", async (request, reply) => {
		if (!requireBearer(request, reply, accessToken)) return;
		return { id: (request.params as { id: string }).id, status: "completed" };
	});
	server.get("/api/v1/jobs/:id/events", async (request, reply) => {
		if (!requireBearer(request, reply, accessToken)) return;
		return reply.header("content-type", "text/event-stream").send(sseBody);
	});
	server.get("/api/v1/realtime", { websocket: true }, (socket, request) => {
		const token = new URL(
			request.raw.url ?? "",
			"http://mock.local",
		).searchParams.get("token");
		if (token !== accessToken) return socket.close(4001, "unauthorized");
		socket.send(JSON.stringify({ type: "proxy_ready" }));
		socket.on("message", (data, isBinary) => {
			realtimeFrames.push({
				data: isBinary
					? Array.isArray(data)
						? Buffer.concat(data.map((part) => Buffer.from(part)))
						: Buffer.from(data as Uint8Array)
					: data.toString(),
				isBinary,
			});
			if (isBinary) return;
			if (String(data).includes('"finalize"')) {
				socket.send(
					JSON.stringify({
						tokens: [
							{ is_final: true, text: "Mock transcript" },
							{ is_final: true, text: "<end>" },
							{ is_final: true, text: "<fin>" },
						],
					}),
				);
			}
		});
	});
	server.get("/api/v1/translations", async (request, reply) => {
		if (!requireBearer(request, reply, accessToken)) return;
		const query = request.query as { q?: unknown };
		return {
			sentences: [{ trans: typeof query.q === "string" ? query.q : "" }],
		};
	});
	server.get("/api/v1/usage/me", async (request, reply) => {
		if (!requireBearer(request, reply, accessToken)) return;
		return { isWhitelisted: true, usedHours: 0, usedMs: 0 };
	});
	server.get("/api/v1/config", async () => config);
	server.get("/api/v1/models", async (request, reply) => {
		if (!requireBearer(request, reply, accessToken)) return;
		return { models: ["mock"] };
	});
	server.get("/api/v1/health", async (_request, reply) =>
		reply.code(204).send(),
	);
	server.get("/__mock/mailbox", async () => ({ messages: mailbox }));

	return {
		authRefreshes: () => [...refreshes],
		clearBehaviors() {
			behaviors.clear();
			behaviorSequences.clear();
			omitUser = false;
			sseBody = defaultSseBody;
		},
		mailbox: () => [...mailbox],
		realtimeFrames: () =>
			realtimeFrames.map((frame) => ({
				...frame,
				...(typeof frame.data === "string"
					? {}
					: { data: Buffer.from(frame.data) }),
			})),
		server,
		transcriptions: () => [...transcriptions],
		uploads: () => [...uploads],
		setBehavior(path: string, behavior: MockProxyBehavior | null) {
			if (behavior) behaviors.set(path, behavior);
			else behaviors.delete(path);
		},
		setBehaviorSequence(
			path: string,
			sequence: readonly (MockProxyBehavior | null)[],
		) {
			behaviorSequences.set(path, [...sequence]);
		},
		setOmitUser(value: boolean) {
			omitUser = value;
		},
		setConfig(value: MockProxyConfig) {
			config = structuredClone(value);
		},
		setSseBody(value: string) {
			sseBody = value;
		},
	};
}

export type MockProxy = Awaited<ReturnType<typeof buildMockProxy>>;
