import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { type BffAuthGateway, ProxyOtpGateway } from "./src/server/auth";
import {
	relayRequest,
	sessionCookieName,
	sessionIdFromCookie,
} from "./src/server/relay";
import {
	type BffSession,
	InMemorySessionStore,
	type SessionStore,
} from "./src/server/session-store";

export interface ServerOptions {
	auth?: BffAuthGateway;
	fetch?: typeof globalThis.fetch;
	sessions?: SessionStore;
	staticDir?: string;
	upstreamUrl?: string;
}

function validEmail(email: unknown): email is string {
	return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validOtp(otp: unknown): otp is string {
	return typeof otp === "string" && /^\d{6}$/.test(otp);
}

function sessionCookie(id: string, expired = false) {
	const expires = expired ? "; Max-Age=0" : "";
	return `${sessionCookieName}=${encodeURIComponent(id)}; Path=/; HttpOnly; Secure; SameSite=Lax${expires}`;
}

export async function buildServer({
	auth,
	fetch = globalThis.fetch,
	sessions = new InMemorySessionStore(),
	staticDir,
	upstreamUrl = process.env.DIDUNY_UPSTREAM_URL ?? "http://127.0.0.1:3910",
}: ServerOptions = {}) {
	const server = Fastify({ logger: false });
	const authGateway = auth ?? new ProxyOtpGateway(fetch, upstreamUrl);
	const refreshes = new Map<string, Promise<BffSession>>();
	const refreshSession = async (id: string, stale: BffSession) => {
		const current = await sessions.get(id);
		if (!current) throw new Error("session no longer exists");
		if (current.accessToken !== stale.accessToken) return current;
		const inFlight = refreshes.get(id);
		if (inFlight) return inFlight;
		const task = authGateway
			.refresh(current)
			.then(async (next) => {
				await sessions.set(id, next);
				return next;
			})
			.catch(async (error) => {
				await sessions.delete(id);
				throw error;
			});
		refreshes.set(id, task);
		try {
			return await task;
		} finally {
			if (refreshes.get(id) === task) refreshes.delete(id);
		}
	};

	server.get("/bff/health", async () => ({ status: "ok" }));
	server.post("/bff/auth/send-otp", async (request, reply) => {
		const email = (request.body as { email?: unknown } | undefined)?.email;
		if (!validEmail(email))
			return reply.code(400).send({ error: "invalid_email" });
		try {
			await authGateway.sendOtp(email);
			return reply.code(204).send();
		} catch {
			return reply.code(502).send({ error: "upstream_auth_unavailable" });
		}
	});
	server.post("/bff/auth/verify-otp", async (request, reply) => {
		const payload = request.body as
			| { email?: unknown; otp?: unknown }
			| undefined;
		if (!validEmail(payload?.email) || !validOtp(payload?.otp)) {
			return reply.code(400).send({ error: "invalid_otp_verification" });
		}
		try {
			const session = await authGateway.verifyOtp(payload.email, payload.otp);
			const id = await sessions.create(session);
			reply.header("set-cookie", sessionCookie(id));
			return { email: session.email };
		} catch {
			return reply.code(401).send({ error: "otp_verification_failed" });
		}
	});
	server.get("/bff/auth/session", async (request) => {
		const id = sessionIdFromCookie(request.headers.cookie);
		const session = id ? await sessions.get(id) : null;
		return session
			? {
					authenticated: true,
					...(session.email ? { email: session.email } : {}),
				}
			: { authenticated: false };
	});
	server.post("/bff/auth/logout", async (request, reply) => {
		const id = sessionIdFromCookie(request.headers.cookie);
		const session = id ? await sessions.get(id) : null;
		if (id) await sessions.delete(id);
		reply.header("set-cookie", sessionCookie("", true));
		if (session) await authGateway.logout(session).catch(() => undefined);
		return reply.code(204).send();
	});
	server.all("/bff/api/*", async (request, reply) => {
		const result = await relayRequest({
			fetch,
			refreshSession,
			request,
			sessions,
			upstreamUrl,
		});
		if (result.kind === "not_found") {
			return reply.code(404).send({ error: "not_found" });
		}
		if (result.kind === "unauthenticated") {
			return reply.code(401).send({ error: "unauthenticated" });
		}
		if (result.kind === "unreachable") {
			return reply.code(502).send({ error: "upstream_unreachable" });
		}
		for (const [name, value] of Object.entries(result.headers))
			reply.header(name, value);
		return reply.code(result.status).send(result.body);
	});

	if (staticDir) {
		await server.register(fastifyStatic, { root: staticDir });
		server.setNotFoundHandler((request, reply) => {
			if (request.url.startsWith("/bff/")) {
				return reply.code(404).send({ error: "Not found" });
			}
			return reply.sendFile("index.html");
		});
	}

	return server;
}
