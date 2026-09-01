import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildServer } from "./server";
import { ProxyOtpGateway, SupabaseOtpGateway } from "./src/server/auth";
import { LibraryStore } from "./src/server/library-store";
import { SqliteSessionStore } from "./src/server/session-store";
import { prepareBffStartup } from "./src/server/startup";

const supabaseUrl =
	process.env.SUPABASE_URL ?? "https://oplmqfsttetsosglilkb.supabase.co";
const supabasePublishableKey =
	process.env.SUPABASE_PUBLISHABLE_KEY ??
	"sb_publishable_kLAVgHi1AGvXF_ZTdAdaEA_Yyfgvv_o";
const host = process.env.HOST ?? "localhost";
const port = Number(process.env.PORT ?? 3000);
const upstreamUrl = process.env.DIDUNY_UPSTREAM_URL;
const startup = await prepareBffStartup({
	dataDir: process.env.DATA_DIR,
	host,
});
const library = await LibraryStore.open({ dataDir: startup.dataDir });
const server = await buildServer({
	auth:
		process.env.DIDUNY_AUTH_PROVIDER === "proxy"
			? new ProxyOtpGateway(
					globalThis.fetch,
					upstreamUrl ?? "http://127.0.0.1:3910",
				)
			: new SupabaseOtpGateway(
					globalThis.fetch,
					supabaseUrl,
					supabasePublishableKey,
				),
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
	...(upstreamUrl ? { upstreamUrl } : {}),
});

await server.listen({ host, port });
