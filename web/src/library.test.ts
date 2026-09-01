import { expect, test } from "bun:test";
import { type LibraryRequest, saveToLibrary } from "./library";

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
