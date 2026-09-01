import { join, resolve } from "node:path";
import { buildServer } from "./server";
import { SupabaseOtpGateway } from "./src/server/auth";
import { SqliteSessionStore } from "./src/server/session-store";
import { prepareBffStartup } from "./src/server/startup";

const supabaseUrl =
	process.env.SUPABASE_URL ?? "https://oplmqfsttetsosglilkb.supabase.co";
const supabasePublishableKey =
	process.env.SUPABASE_PUBLISHABLE_KEY ??
	"sb_publishable_kLAVgHi1AGvXF_ZTdAdaEA_Yyfgvv_o";
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const startup = await prepareBffStartup({
	dataDir: process.env.DATA_DIR,
	host,
});
const server = await buildServer({
	auth: new SupabaseOtpGateway(
		globalThis.fetch,
		supabaseUrl,
		supabasePublishableKey,
	),
	sessions: new SqliteSessionStore(join(startup.dataDir, "diduny.db")),
	staticDir: resolve("web/dist"),
});

await server.listen({ host, port });
