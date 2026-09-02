import { expect, test } from "bun:test";
import {
	type LibraryRequest,
	deleteLibraryRecording,
	getLibraryRecording,
	listLibraryRecordings,
	saveToLibrary,
	updateLibraryRecording,
} from "./library";

test("saves dictation metadata first and streams the Blob through the BFF upload URL", async () => {
	const calls: Array<{ init?: RequestInit; path: string }> = [];
	const audio = new Blob(["audio"], { type: "audio/webm" });
	const request: LibraryRequest = async (path, init) => {
		calls.push({ init, path: String(path) });
		return calls.length === 1
			? Response.json(
					{ id: "f0e11966-578b-4854-926b-8a32cf0dc9fd" },
					{ status: 201 },
				)
			: Response.json({ id: "recording-id" }, { status: 201 });
	};

	await saveToLibrary(
		{
			audio,
			durationSeconds: 2,
			text: "Saved text",
		},
		request,
	);

	expect(calls[0]).toMatchObject({ path: "/bff/library" });
	expect(calls[1]?.init).toMatchObject({
		headers: { "content-type": "audio/webm" },
	});
	expect(calls[1]).toMatchObject({
		init: expect.objectContaining({ body: audio, method: "PUT" }),
		path: "/bff/library/f0e11966-578b-4854-926b-8a32cf0dc9fd/media",
	});
});

test("saves translated dictation with its translation type and completed status", async () => {
	const calls: Array<{ init?: RequestInit; path: string }> = [];
	const request: LibraryRequest = async (path, init) => {
		calls.push({ init, path: String(path) });
		return calls.length === 1
			? Response.json({ id: "translation-id" }, { status: 201 })
			: Response.json({ id: "translation-id" }, { status: 201 });
	};

	await saveToLibrary(
		{
			audio: new Blob(["audio"], { type: "audio/webm" }),
			durationSeconds: 2,
			status: "translated",
			text: "Translated text",
			type: "translation",
		},
		request,
	);

	expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
		durationSeconds: 2,
		status: "translated",
		text: "Translated text",
		type: "translation",
	});
});

test("uses one BFF list path for search, filters, detail, update, and deletion", async () => {
	const calls: Array<{ init?: RequestInit; path: string }> = [];
	const summary = {
		createdAt: 1,
		displayTitle: "Untitled recording",
		durationSeconds: 1,
		hasTranslation: false,
		id: "recording-id",
		status: "transcribed" as const,
		type: "voice" as const,
	};
	const detail = {
		...summary,
		displayText: "Saved text",
		history: [],
		media: {
			contentType: "audio/webm",
			fileName: "recording-id.webm",
			fileSizeBytes: 1,
			id: "recording-id",
		},
		text: "Saved text",
	};
	const request: LibraryRequest = async (path, init) => {
		calls.push({ init, path });
		if (init?.method === "PATCH") {
			return Response.json({ id: "recording-id", title: "Board notes" });
		}
		if (init?.method === "DELETE") return new Response(null, { status: 204 });
		if (path.includes("recording-id")) {
			return Response.json(detail);
		}
		return Response.json({ items: [summary] });
	};

	expect(
		await listLibraryRecordings(
			{ search: "board notes", status: ["transcribed"], type: ["voice"] },
			request,
		),
	).toEqual({ items: [summary] });
	expect(calls[0]?.path).toBe(
		"/bff/library?search=board+notes&status=transcribed&type=voice",
	);
	expect(await getLibraryRecording("recording-id", request)).toEqual(detail);
	await updateLibraryRecording(
		"recording-id",
		{ title: "Board notes" },
		request,
	);
	await deleteLibraryRecording("recording-id", request);
	expect(calls.slice(1)).toMatchObject([
		{ path: "/bff/library/recording-id" },
		{
			init: expect.objectContaining({ method: "PATCH" }),
			path: "/bff/library/recording-id",
		},
		{
			init: expect.objectContaining({ method: "DELETE" }),
			path: "/bff/library/recording-id",
		},
	]);
});
