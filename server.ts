import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

export interface ServerOptions {
	staticDir?: string;
}

export async function buildServer({ staticDir }: ServerOptions = {}) {
	const server = Fastify({ logger: false });

	server.get("/bff/health", async () => ({ status: "ok" }));

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
