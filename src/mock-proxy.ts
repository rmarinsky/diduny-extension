import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";

export type MockProxyBehavior = "hang" | "malformed" | "quota" | "unauthorized";

export interface MockMailboxMessage {
	email: string;
	otp: string;
}

function requestPath(url: string | undefined) {
	return new URL(url ?? "", "http://mock.local").pathname;
}

function requireBearer(
	request: { headers: { authorization?: string } },
	reply: FastifyReply,
) {
	if (request.headers.authorization === "Bearer mock-access-token") return true;
	reply.code(401).send({ error: "unauthorized" });
	return false;
}

export async function buildMockProxy() {
	const server = Fastify({ logger: false });
	const mailbox: MockMailboxMessage[] = [];
	const behaviors = new Map<string, MockProxyBehavior>();
	await server.register(websocket);
	server.addContentTypeParser(
		/^multipart\/form-data/i,
		(_request, payload, done) => done(null, payload),
	);
	server.addHook("preHandler", (request, reply, done) => {
		const behavior = behaviors.get(requestPath(request.raw.url));
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
			accessToken: "mock-access-token",
			accessTokenExpiresAt: Date.now() + 300_000,
			refreshToken: "mock-refresh-token",
			user: { email: payload.email },
		};
	});
	server.post("/api/v1/auth/refresh", async (request, reply) => {
		const refreshToken = (
			request.body as { refreshToken?: unknown } | undefined
		)?.refreshToken;
		if (refreshToken !== "mock-refresh-token")
			return reply.code(401).send({ error: "invalid_refresh_token" });
		return {
			accessToken: "mock-access-token",
			accessTokenExpiresAt: Date.now() + 300_000,
			refreshToken: "mock-refresh-token",
		};
	});
	server.post("/api/v1/auth/logout", async (request, reply) => {
		if (!requireBearer(request, reply)) return;
		return reply.code(204).send();
	});

	server.post("/api/v1/transcriptions", async (request, reply) => {
		if (!requireBearer(request, reply)) return;
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
		if (!requireBearer(request, reply)) return;
		const text = (request.body as { text?: unknown } | undefined)?.text;
		return { text: typeof text === "string" ? text : "" };
	});
	server.post("/api/v1/jobs", async (request, reply) => {
		if (!requireBearer(request, reply)) return;
		return {
			createdAt: new Date().toISOString(),
			jobId: "mock-job",
			status: "queued",
		};
	});
	server.get("/api/v1/jobs/:id", async (request, reply) => {
		if (!requireBearer(request, reply)) return;
		return { id: (request.params as { id: string }).id, status: "completed" };
	});
	server.get("/api/v1/jobs/:id/events", async (request, reply) => {
		if (!requireBearer(request, reply)) return;
		return reply
			.header("content-type", "text/event-stream")
			.send(
				': mock keepalive\n\nevent: status\ndata: processing\n\nevent: completed\ndata: {"text":"Mock transcript","tokens":[]}\n\n',
			);
	});
	server.get("/api/v1/realtime", { websocket: true }, (socket, request) => {
		const token = new URL(
			request.raw.url ?? "",
			"http://mock.local",
		).searchParams.get("token");
		if (token !== "mock-access-token")
			return socket.close(4001, "unauthorized");
		socket.send(JSON.stringify({ type: "proxy_ready" }));
		socket.on("message", (data, isBinary) => {
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
		if (!requireBearer(request, reply)) return;
		const query = request.query as { q?: unknown };
		return {
			sentences: [{ trans: typeof query.q === "string" ? query.q : "" }],
		};
	});
	server.get("/api/v1/usage/me", async (request, reply) => {
		if (!requireBearer(request, reply)) return;
		return { isWhitelisted: true, usedHours: 0, usedMs: 0 };
	});
	server.get("/api/v1/config", async () => ({
		endpoints: { sttBaseURL: "mock://local", sttModel: "mock" },
		featureFlags: { realtime: true },
		messages: {},
		version: "mock",
	}));
	server.get("/api/v1/models", async (request, reply) => {
		if (!requireBearer(request, reply)) return;
		return { models: ["mock"] };
	});
	server.get("/api/v1/health", async (_request, reply) =>
		reply.code(204).send(),
	);
	server.get("/__mock/mailbox", async () => ({ messages: mailbox }));

	return {
		mailbox: () => [...mailbox],
		server,
		setBehavior(path: string, behavior: MockProxyBehavior | null) {
			if (behavior) behaviors.set(path, behavior);
			else behaviors.delete(path);
		},
	};
}

export type MockProxy = Awaited<ReturnType<typeof buildMockProxy>>;
