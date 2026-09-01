import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../server";

test("reports BFF process and proxy reachability separately", async () => {
	const server = await buildServer({
		fetch: async (url) => {
			expect(String(url)).toBe("http://127.0.0.1:3910/api/v1/health");
			return new Response(null, { status: 204 });
		},
	});
	const response = await server.inject({ method: "GET", url: "/bff/health" });

	expect(response.statusCode).toBe(200);
	expect(response.json()).toEqual({
		activeRealtimeSockets: 0,
		proxy: { reachable: true, status: 204 },
		status: "ok",
	});

	await server.close();
});

test("reports a stalled proxy as unreachable within the BFF timeout", async () => {
	let aborted = 0;
	const server = await buildServer({
		fetch: async (_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => {
						aborted += 1;
						reject(new Error("proxy request aborted"));
					},
					{ once: true },
				);
			}),
		proxyTimeoutMs: 10,
	});
	try {
		const response = await Promise.race([
			server.inject({ method: "GET", url: "/bff/health" }),
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error("health route did not time out")),
					250,
				),
			),
		]);

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			activeRealtimeSockets: 0,
			proxy: { reachable: false },
			status: "ok",
		});
		expect(aborted).toBe(1);
	} finally {
		await server.close();
	}
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
