import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildServer } from "./server";
import { ProxyOtpGateway } from "./src/server/auth";
import { LibraryStore } from "./src/server/library-store";
import { SqliteSessionStore } from "./src/server/session-store";
import { prepareBffStartup } from "./src/server/startup";

const host = process.env.HOST ?? "localhost";
const port = Number(process.env.PORT ?? 3000);
const upstreamUrl = process.env.DIDUNY_UPSTREAM_URL ?? "http://127.0.0.1:3910";
const startup = await prepareBffStartup({
	dataDir: process.env.DATA_DIR,
	host,
});
const library = await LibraryStore.open({ dataDir: startup.dataDir });
const server = await buildServer({
	auth: new ProxyOtpGateway(globalThis.fetch, upstreamUrl),
	library,
	log: (line) => console.info(line),
	logLevel: process.env.DIDUNY_LOG_LEVEL as
		| "debug"
		| "error"
		| "info"
		| undefined,
	sessions: new SqliteSessionStore(
		join(startup.dataDir, "diduny.db"),
		await readFile(startup.sessionSecretPath, "utf8"),
	),
	staticDir: resolve("web/dist"),
	upstreamUrl,
});

await server.listen({ host, port });
