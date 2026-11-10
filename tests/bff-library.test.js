import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, defaultExtensionOrigin } from "../server";
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
		const captions = await server.inject({
			headers: { cookie },
			method: "GET",
			url: `/bff/library/${saved?.id}/captions.vtt`,
		});
		expect(captions.statusCode).toBe(200);
		expect(captions.headers["content-type"]).toContain("text/vtt");
		expect(captions.body).toContain("A saved Diduny note");

		const unsafe = await server.inject({
			headers: { cookie },
			method: "GET",
			url: "/bff/library/not-an-id/media",
		});
		expect(unsafe.statusCode).toBe(400);
		const invalidFilter = await server.inject({
			headers: { cookie },
			method: "GET",
			url: "/bff/library?status=not-a-status",
		});
		expect(invalidFilter.statusCode).toBe(400);
		expect(invalidFilter.json()).toEqual({ error: "invalid_library_filter" });

		const updated = await server.inject({
			headers: { cookie },
			method: "PATCH",
			payload: {
				description: "Notes from the extension review",
				title: "Extension review",
			},
			url: `/bff/library/${saved?.id}`,
		});
		expect(updated.statusCode).toBe(200);
		expect(updated.json()).toEqual(
			expect.objectContaining({
				description: "Notes from the extension review",
				title: "Extension review",
			}),
		);
		const titleSearch = await server.inject({
			headers: { cookie },
			method: "GET",
			url: "/bff/library?search=extension",
		});
		expect(titleSearch.json().items).toEqual([
			expect.objectContaining({
				id: saved?.id,
				displayTitle: "Extension review",
			}),
		]);

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
			origin: defaultExtensionOrigin,
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
		const invalidSegments = await server.inject({
			headers: extensionHeaders,
			method: "POST",
			payload: {
				durationSeconds: 1,
				segments: [
					{
						endMs: 0,
						startMs: 1,
						text: "Impossible timing",
					},
				],
				status: "transcribed",
				text: "Extension library copy",
				type: "voice",
			},
			url: "/bff/extension/library",
		});
		expect(invalidSegments.statusCode).toBe(400);

		const created = await server.inject({
			headers: extensionHeaders,
			method: "POST",
			payload: {
				durationSeconds: 1,
				segments: [
					{
						endMs: 1_000,
						speaker: "1",
						startMs: 0,
						text: "Extension library copy",
					},
				],
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
			expect.objectContaining({
				segments: [
					{
						endMs: 1_000,
						speaker: "1",
						startMs: 0,
						text: "Extension library copy",
					},
				],
				text: "Extension library copy",
			}),
		);
	} finally {
		await server.close();
		await library.close();
		await rm(dataDir, { force: true, recursive: true });
	}
});

test("replays an extension capture idempotently after a BFF rebuild", async () => {
	const dataDir = await mkdtemp(
		join(tmpdir(), "diduny-extension-library-idempotency-"),
	);
	const library = await LibraryStore.open({ dataDir });
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only" });
	const scratchId = "22e4aed8-69f8-4204-94fd-359f5199c0d2";
	const extensionHeaders = {
		cookie: `diduny_extension_session=${sessionId}`,
		"idempotency-key": scratchId,
		origin: defaultExtensionOrigin,
	};
	const recording = {
		durationSeconds: 1,
		status: "partiallyRecovered",
		text: "Replay this recovered extension capture once",
		type: "meeting",
	};
	let server = await buildServer({ library, sessions });
	try {
		const stagedBeforeRebuild = await server.inject({
			headers: extensionHeaders,
			method: "POST",
			payload: recording,
			url: "/bff/extension/library",
		});
		expect(stagedBeforeRebuild.statusCode).toBe(201);

		await server.close();
		server = await buildServer({ library, sessions });
		const stagedAfterRebuild = await server.inject({
			headers: extensionHeaders,
			method: "POST",
			payload: recording,
			url: "/bff/extension/library",
		});
		expect(stagedAfterRebuild.statusCode).toBe(201);

		const upload = await server.inject({
			headers: {
				cookie: extensionHeaders.cookie,
				"content-type": "audio/webm",
				origin: defaultExtensionOrigin,
			},
			method: "PUT",
			payload: "recovered-extension-audio",
			url: `/bff/extension/library/${stagedAfterRebuild.json().id}/media`,
		});
		expect(upload.statusCode).toBe(201);

		const replayed = await server.inject({
			headers: extensionHeaders,
			method: "POST",
			payload: recording,
			url: "/bff/extension/library",
		});
		expect(replayed.statusCode).toBe(200);
		expect(replayed.json()).toEqual(
			expect.objectContaining({ id: scratchId, saved: true }),
		);

		const recordings = await server.inject({
			headers: { cookie: `diduny_session=${sessionId}` },
			method: "GET",
			url: "/bff/library",
		});
		expect(recordings.json().items).toHaveLength(1);
	} finally {
		await server.close();
		await library.close();
		await rm(dataDir, { force: true, recursive: true });
	}
});

test("replays a persist-then-failed extension upload without saving the audio twice", async () => {
	const dataDir = await mkdtemp(
		join(tmpdir(), "diduny-extension-library-ambiguous-save-"),
	);
	const library = await LibraryStore.open({ dataDir });
	const saveStream = library.saveStream.bind(library);
	let saveStreamCalls = 0;
	library.saveStream = async (...args) => {
		saveStreamCalls += 1;
		await saveStream(...args);
		throw new Error("upload response was lost after the durable save");
	};
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only" });
	const scratchId = "ca7d67ba-7d7c-4e10-95a2-bae80f25e77d";
	const extensionHeaders = {
		cookie: `diduny_extension_session=${sessionId}`,
		"idempotency-key": scratchId,
		origin: defaultExtensionOrigin,
	};
	const recording = {
		durationSeconds: 1,
		status: "partiallyRecovered",
		text: "Save this recovered extension capture exactly once",
		type: "meeting",
	};
	const server = await buildServer({ library, sessions });
	try {
		const staged = await server.inject({
			headers: extensionHeaders,
			method: "POST",
			payload: recording,
			url: "/bff/extension/library",
		});
		expect(staged.statusCode).toBe(201);

		const ambiguousUpload = await server.inject({
			headers: {
				cookie: extensionHeaders.cookie,
				"content-type": "audio/webm",
				origin: defaultExtensionOrigin,
			},
			method: "PUT",
			payload: "persisted-extension-audio",
			url: `/bff/extension/library/${staged.json().id}/media`,
		});
		expect(ambiguousUpload.statusCode).toBe(500);

		const replayed = await server.inject({
			headers: extensionHeaders,
			method: "POST",
			payload: recording,
			url: "/bff/extension/library",
		});
		expect(replayed.statusCode).toBe(200);
		expect(replayed.json()).toEqual(
			expect.objectContaining({ id: scratchId, saved: true }),
		);
		expect(saveStreamCalls).toBe(1);
		const freshStages = await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				server.inject({
					headers: {
						cookie: extensionHeaders.cookie,
						origin: defaultExtensionOrigin,
					},
					method: "POST",
					payload: {
						durationSeconds: 1,
						status: "partiallyRecovered",
						text: `Fresh capture after ambiguous save ${index}`,
						type: "meeting",
					},
					url: "/bff/extension/library",
				}),
			),
		);
		expect(freshStages.map((response) => response.statusCode)).toEqual(
			Array.from({ length: 8 }, () => 201),
		);

		const recordings = await server.inject({
			headers: { cookie: `diduny_session=${sessionId}` },
			method: "GET",
			url: "/bff/library",
		});
		expect(recordings.json().items).toHaveLength(1);
	} finally {
		await server.close();
		await library.close();
		await rm(dataDir, { force: true, recursive: true });
	}
});

test("saves a staged extension capture only once when duplicate uploads overlap", async () => {
	const dataDir = await mkdtemp(
		join(tmpdir(), "diduny-extension-library-race-"),
	);
	const library = await LibraryStore.open({ dataDir });
	const saveStream = library.saveStream.bind(library);
	let saveStreamCalls = 0;
	let markSaveStarted;
	const saveStarted = new Promise((resolve) => {
		markSaveStarted = resolve;
	});
	let releaseSave;
	const saveReleased = new Promise((resolve) => {
		releaseSave = resolve;
	});
	library.saveStream = async (...args) => {
		saveStreamCalls += 1;
		markSaveStarted();
		await saveReleased;
		return saveStream(...args);
	};
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only" });
	const server = await buildServer({ library, sessions });
	try {
		const extensionHeaders = {
			cookie: `diduny_extension_session=${sessionId}`,
			origin: defaultExtensionOrigin,
		};
		const created = await server.inject({
			headers: extensionHeaders,
			method: "POST",
			payload: {
				durationSeconds: 1,
				status: "partiallyRecovered",
				text: "One recovered meeting capture",
				type: "meeting",
			},
			url: "/bff/extension/library",
		});
		expect(created.statusCode).toBe(201);

		const uploadOptions = {
			headers: { ...extensionHeaders, "content-type": "audio/webm" },
			method: "PUT",
			payload: "one-capture-upload",
			url: `/bff/extension/library/${created.json().id}/media`,
		};
		const firstUpload = server.inject(uploadOptions);
		await saveStarted;
		const overlappingUpload = await server.inject(uploadOptions);
		expect(overlappingUpload.statusCode).toBe(409);
		expect(overlappingUpload.json()).toEqual({
			error: "recording_upload_in_progress",
		});

		releaseSave();
		const firstUploadResult = await firstUpload;
		expect(firstUploadResult.statusCode).toBe(201);
		expect(saveStreamCalls).toBe(1);

		const recordings = await server.inject({
			headers: { cookie: `diduny_session=${sessionId}` },
			method: "GET",
			url: "/bff/library",
		});
		expect(recordings.json().items).toHaveLength(1);
	} finally {
		releaseSave();
		await server.close();
		await library.close();
		await rm(dataDir, { force: true, recursive: true });
	}
});

test("keeps a staged extension capture retryable after its first library save fails", async () => {
	const dataDir = await mkdtemp(
		join(tmpdir(), "diduny-extension-library-retry-"),
	);
	const library = await LibraryStore.open({ dataDir });
	const saveStream = library.saveStream.bind(library);
	let failFirstSave = true;
	library.saveStream = async (...args) => {
		if (failFirstSave) {
			failFirstSave = false;
			throw new Error("temporary storage failure");
		}
		return saveStream(...args);
	};
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only" });
	const server = await buildServer({ library, sessions });
	try {
		const extensionHeaders = {
			cookie: `diduny_extension_session=${sessionId}`,
			origin: defaultExtensionOrigin,
		};
		const created = await server.inject({
			headers: extensionHeaders,
			method: "POST",
			payload: {
				durationSeconds: 1,
				status: "partiallyRecovered",
				text: "Retry this recovered meeting capture",
				type: "meeting",
			},
			url: "/bff/extension/library",
		});
		const recordingId = created.json().id;
		expect(created.statusCode).toBe(201);

		const failed = await server.inject({
			headers: { ...extensionHeaders, "content-type": "audio/webm" },
			method: "PUT",
			payload: "first-attempt-audio",
			url: `/bff/extension/library/${recordingId}/media`,
		});
		expect(failed.statusCode).toBe(500);

		const retry = await server.inject({
			headers: { ...extensionHeaders, "content-type": "audio/webm" },
			method: "PUT",
			payload: "retry-audio",
			url: `/bff/extension/library/${recordingId}/media`,
		});
		expect(retry.statusCode).toBe(201);
		expect(retry.json()).toEqual(
			expect.objectContaining({ text: "Retry this recovered meeting capture" }),
		);
	} finally {
		await server.close();
		await library.close();
		await rm(dataDir, { force: true, recursive: true });
	}
});

test("keeps an in-flight extension capture within the pending limit when its save fails", async () => {
	const dataDir = await mkdtemp(
		join(tmpdir(), "diduny-extension-library-pending-limit-"),
	);
	const library = await LibraryStore.open({ dataDir });
	const saveStream = library.saveStream.bind(library);
	let markSaveStarted;
	const saveStarted = new Promise((resolve) => {
		markSaveStarted = resolve;
	});
	let releaseFailedSave;
	const failedSaveReleased = new Promise((resolve) => {
		releaseFailedSave = resolve;
	});
	let failInFlightSave = true;
	library.saveStream = async (...args) => {
		if (failInFlightSave) {
			failInFlightSave = false;
			markSaveStarted();
			await failedSaveReleased;
			throw new Error("temporary storage failure");
		}
		return saveStream(...args);
	};
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only" });
	const server = await buildServer({ library, sessions });
	try {
		const extensionHeaders = {
			cookie: `diduny_extension_session=${sessionId}`,
			origin: defaultExtensionOrigin,
		};
		const staged = await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				server.inject({
					headers: extensionHeaders,
					method: "POST",
					payload: {
						durationSeconds: 1,
						status: "partiallyRecovered",
						text: `Pending recovered capture ${index}`,
						type: "meeting",
					},
					url: "/bff/extension/library",
				}),
			),
		);
		expect(staged.every((response) => response.statusCode === 201)).toBeTrue();
		const recordingId = staged[0].json().id;

		const upload = server.inject({
			headers: { ...extensionHeaders, "content-type": "audio/webm" },
			method: "PUT",
			payload: "first-attempt-audio",
			url: `/bff/extension/library/${recordingId}/media`,
		});
		await saveStarted;
		const overflow = await server.inject({
			headers: extensionHeaders,
			method: "POST",
			payload: {
				durationSeconds: 1,
				status: "partiallyRecovered",
				text: "Must remain outside the pending limit",
				type: "meeting",
			},
			url: "/bff/extension/library",
		});
		releaseFailedSave();
		const failed = await upload;
		const retry = await server.inject({
			headers: { ...extensionHeaders, "content-type": "audio/webm" },
			method: "PUT",
			payload: "retry-audio",
			url: `/bff/extension/library/${recordingId}/media`,
		});

		expect(overflow.statusCode).toBe(429);
		expect(failed.statusCode).toBe(500);
		expect(retry.statusCode).toBe(201);
	} finally {
		await server.close();
		await library.close();
		await rm(dataDir, { force: true, recursive: true });
	}
});
