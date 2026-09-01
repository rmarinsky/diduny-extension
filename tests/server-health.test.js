import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../server";

test("reports BFF process health without reaching the upstream backend", async () => {
	const server = await buildServer();
	const response = await server.inject({ method: "GET", url: "/bff/health" });

	expect(response.statusCode).toBe(200);
	expect(response.json()).toEqual({
		activeRealtimeSockets: 0,
		status: "ok",
	});

	await server.close();
});

test("serves the built SPA from the BFF origin", async () => {
	const staticDir = await mkdtemp(join(tmpdir(), "diduny-web-"));
	await writeFile(`${staticDir}/index.html`, "<main>Diduny web</main>");
	const server = await buildServer({ staticDir });

	const response = await server.inject({ method: "GET", url: "/" });

	expect(response.statusCode).toBe(200);
	expect(response.body).toContain("Diduny web");

	await server.close();
	await rm(staticDir, { force: true, recursive: true });
});
