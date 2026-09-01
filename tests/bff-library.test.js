import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../server";
import { LibraryStore } from "../src/server/library-store";
import { InMemorySessionStore } from "../src/server/session-store";

test("serves the authenticated local library with media ranges and rejects unsafe media ids", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "diduny-bff-library-"));
	const library = await LibraryStore.open({ dataDir });
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only" });
	const server = await buildServer({ library, sessions });
	try {
		const saved = await library.save(
			{
				durationSeconds: 2,
				status: "transcribed",
				text: "A saved Diduny note",
				type: "voice",
			},
			{
				bytes: new TextEncoder().encode("audio-body"),
				contentType: "audio/webm",
			},
		);
		const cookie = `diduny_session=${sessionId}`;

		const list = await server.inject({
			headers: { cookie },
			method: "GET",
			url: "/bff/library?search=Diduny",
		});
		expect(list.statusCode).toBe(200);
		expect(list.json().items).toEqual([
			expect.objectContaining({ id: saved?.id, type: "voice" }),
		]);
		expect(JSON.stringify(list.json().items)).not.toContain(
			"A saved Diduny note",
		);

		const media = await server.inject({
			headers: { cookie, range: "bytes=1-5" },
			method: "GET",
			url: `/bff/library/${saved?.id}/media`,
		});
		expect(media.statusCode).toBe(206);
		expect(media.headers["content-range"]).toBe("bytes 1-5/10");
		expect(media.body).toBe("udio-");

		const unsafe = await server.inject({
			headers: { cookie },
			method: "GET",
			url: "/bff/library/not-an-id/media",
		});
		expect(unsafe.statusCode).toBe(400);

		const removed = await server.inject({
			headers: { cookie },
			method: "DELETE",
			url: `/bff/library/${saved?.id}`,
		});
		expect(removed.statusCode).toBe(204);
		const afterDelete = await server.inject({
			headers: { cookie },
			method: "GET",
			url: `/bff/library/${saved?.id}`,
		});
		expect(afterDelete.statusCode).toBe(404);
	} finally {
		await server.close();
		await library.close();
		await rm(dataDir, { force: true, recursive: true });
	}
});

test("stages an authenticated capture without buffering audio in the BFF route", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "diduny-bff-library-upload-"));
	const library = await LibraryStore.open({ dataDir });
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only" });
	const server = await buildServer({ library, sessions });
	try {
		const cookie = `diduny_session=${sessionId}`;
		const invalid = await server.inject({
			headers: { cookie },
			method: "POST",
			payload: {
				durationSeconds: 1,
				status: "transcribed",
				text: "Malformed metadata must not reach storage",
				title: 42,
				type: "voice",
			},
			url: "/bff/library",
		});
		expect(invalid.statusCode).toBe(400);
		const created = await server.inject({
			headers: { cookie },
			method: "POST",
			payload: {
				durationSeconds: 1,
				status: "transcribed",
				text: "Saved below the delivery cut line",
				type: "voice",
			},
			url: "/bff/library",
		});
		expect(created.statusCode).toBe(201);
		const upload = await server.inject({
			headers: { "content-type": "audio/webm", cookie },
			method: "PUT",
			payload: "streamed-audio",
			url: `/bff/library/${created.json().id}/media`,
		});
		expect(upload.statusCode).toBe(201);
		expect(upload.json()).toEqual(
			expect.objectContaining({ text: "Saved below the delivery cut line" }),
		);
		const media = await server.inject({
			headers: { cookie },
			method: "GET",
			url: `/bff/library/${upload.json().id}/media`,
		});
		expect(media.body).toBe("streamed-audio");

		for (let index = 0; index < 8; index += 1) {
			const staged = await server.inject({
				headers: { cookie },
				method: "POST",
				payload: {
					durationSeconds: index,
					status: "transcribed",
					text: `Pending ${index}`,
					type: "voice",
				},
				url: "/bff/library",
			});
			expect(staged.statusCode).toBe(201);
		}
		const overflow = await server.inject({
			headers: { cookie },
			method: "POST",
			payload: {
				durationSeconds: 9,
				status: "transcribed",
				text: "One pending capture too many",
				type: "voice",
			},
			url: "/bff/library",
		});
		expect(overflow.statusCode).toBe(429);
	} finally {
		await server.close();
		await library.close();
		await rm(dataDir, { force: true, recursive: true });
	}
});

test("lets an extension session stream its capture into the local library", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "diduny-extension-library-"));
	const library = await LibraryStore.open({ dataDir });
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only" });
	const server = await buildServer({ library, sessions });
	try {
		const extensionHeaders = {
			cookie: `diduny_extension_session=${sessionId}`,
			"sec-fetch-site": "none",
		};
		const rejected = await server.inject({
			headers: { cookie: extensionHeaders.cookie },
			method: "POST",
			payload: {
				durationSeconds: 1,
				status: "transcribed",
				text: "Extension library copy",
				type: "voice",
			},
			url: "/bff/extension/library",
		});
		expect(rejected.statusCode).toBe(403);

		const created = await server.inject({
			headers: extensionHeaders,
			method: "POST",
			payload: {
				durationSeconds: 1,
				status: "transcribed",
				text: "Extension library copy",
				type: "voice",
			},
			url: "/bff/extension/library",
		});
		expect(created.statusCode).toBe(201);

		const upload = await server.inject({
			headers: {
				...extensionHeaders,
				"content-type": "audio/webm",
			},
			method: "PUT",
			payload: "extension-streamed-audio",
			url: `/bff/extension/library/${created.json().id}/media`,
		});
		expect(upload.statusCode).toBe(201);
		expect(upload.json()).toEqual(
			expect.objectContaining({ text: "Extension library copy" }),
		);
	} finally {
		await server.close();
		await library.close();
		await rm(dataDir, { force: true, recursive: true });
	}
});
