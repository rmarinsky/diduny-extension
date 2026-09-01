import { resolve } from "node:path";
import { buildServer } from "./server";

const server = await buildServer({ staticDir: resolve("web/dist") });
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

await server.listen({ host, port });
