import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../server";
import { LibraryStore } from "../src/server/library-store";
import { InMemorySessionStore } from "../src/server/session-store";

test("streams an authenticated portable library export without leaving a zip in DATA_DIR", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "diduny-library-export-"));
	const library = await LibraryStore.open({ dataDir });
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only" });
	const server = await buildServer({ library, sessions });
	try {
		const saved = await library.save(
			{
				durationSeconds: 2,
				status: "transcribed",
				text: "A portable transcript",
				title: "Export fixture",
				type: "voice",
			},
			{
				bytes: new TextEncoder().encode("portable-audio"),
				contentType: "audio/webm",
			},
		);

		const unauthenticated = await server.inject({
			method: "GET",
			url: "/bff/library/export",
		});
		expect(unauthenticated.statusCode).toBe(401);

		const exported = await server.inject({
			headers: { cookie: `diduny_session=${sessionId}` },
			method: "GET",
			url: "/bff/library/export",
		});
		expect(exported.statusCode).toBe(200);
		expect(exported.headers["content-type"]).toContain("application/zip");
		expect(exported.headers["content-disposition"]).toContain(
			"diduny-library.zip",
		);
		expect(exported.body.slice(0, 4)).toBe("PK\x03\x04");
		expect(exported.body).toContain("portable-audio");
		expect(exported.body).toContain("A portable transcript");
		expect(exported.body).toContain(`${saved?.id}/transcript.txt`);
		expect(
			(await readdir(dataDir)).filter((name) => name.endsWith(".zip")),
		).toEqual([]);
	} finally {
		await server.close();
		await library.close();
		await rm(dataDir, { force: true, recursive: true });
	}
});
