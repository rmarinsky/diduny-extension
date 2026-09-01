import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { relayRequest } from "./src/server/relay";
import {
	InMemorySessionStore,
	type SessionStore,
} from "./src/server/session-store";

export interface ServerOptions {
	fetch?: typeof globalThis.fetch;
	sessions?: SessionStore;
	staticDir?: string;
	upstreamUrl?: string;
}

export async function buildServer({
	fetch = globalThis.fetch,
	sessions = new InMemorySessionStore(),
	staticDir,
	upstreamUrl = process.env.DIDUNY_UPSTREAM_URL ?? "http://127.0.0.1:3910",
}: ServerOptions = {}) {
	const server = Fastify({ logger: false });

	server.get("/bff/health", async () => ({ status: "ok" }));
	server.all("/bff/api/*", async (request, reply) => {
		const result = await relayRequest({
			fetch,
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
