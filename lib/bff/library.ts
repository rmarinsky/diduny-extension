import type { ProcessingStatus, RecordingType } from "../../src/core/models";
import { bffFetch } from "./client";

export type LibraryRecordingType = RecordingType;

export interface LibrarySaveInput {
	audio: Blob;
	durationSeconds: number;
	status?: ProcessingStatus;
	text: string;
	type: LibraryRecordingType;
}

export type LibraryRequest = (
	path: string,
	init?: RequestInit,
) => Promise<Response>;

function errorFor(response: Response, action: string) {
	return new Error(`${action} failed (${response.status})`);
}

export async function saveLibraryRecording(
	{
		audio,
		durationSeconds,
		status = "transcribed",
		text,
		type,
	}: LibrarySaveInput,
	path: string,
	request: LibraryRequest,
) {
	const created = await request(path, {
		body: JSON.stringify({
			durationSeconds,
			status,
			text,
			type,
		}),
		credentials: "include",
		headers: { "content-type": "application/json" },
		method: "POST",
	});
	if (!created.ok) throw errorFor(created, "Library save");
	const body: unknown = await created.json();
	if (
		!body ||
		typeof body !== "object" ||
		!("id" in body) ||
		typeof body.id !== "string"
	) {
		throw new Error("Library save returned no upload id");
	}
	const uploaded = await request(`${path}/${body.id}/media`, {
		body: audio,
		credentials: "include",
		headers: { "content-type": audio.type || "audio/webm" },
		method: "PUT",
	});
	if (!uploaded.ok) throw errorFor(uploaded, "Library audio upload");
	return uploaded.json() as Promise<unknown>;
}

export function saveExtensionRecording(
	input: LibrarySaveInput,
	bffOrigin: string,
) {
	return saveLibraryRecording(input, "/bff/extension/library", (path, init) =>
		bffFetch(path, init, bffOrigin),
	);
}
