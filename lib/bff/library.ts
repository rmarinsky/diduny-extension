import { DidunyError } from "../../src/core/errors";
import type {
	ProcessingStatus,
	RecordingType,
	TranscriptSegment,
} from "../../src/core/models";
import { bffFetch } from "./client";

export type LibraryRecordingType = RecordingType;

export interface LibrarySaveInput {
	audio: Blob;
	durationSeconds: number;
	segments?: readonly TranscriptSegment[];
	status?: ProcessingStatus;
	text: string;
	type: LibraryRecordingType;
}

export function extensionRecordingStatus({
	partiallyRecovered,
	transcribed,
	translation,
}: {
	partiallyRecovered: boolean;
	transcribed: boolean;
	translation: boolean;
}): ProcessingStatus {
	if (partiallyRecovered) return "partiallyRecovered";
	if (!transcribed) return "failed";
	return translation ? "translated" : "transcribed";
}

export type LibraryRequest = (
	path: string,
	init?: RequestInit,
) => Promise<Response>;

function errorFor(response: Response) {
	if (response.status === 401)
		return new DidunyError("authentication_failed", {
			status: response.status,
		});
	if (response.status === 402)
		return new DidunyError("quota_exhausted", { status: response.status });
	return new DidunyError("request_rejected", { status: response.status });
}

export async function saveLibraryRecording(
	{
		audio,
		durationSeconds,
		segments,
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
			...(segments?.length ? { segments } : {}),
			status,
			text,
			type,
		}),
		credentials: "include",
		headers: { "content-type": "application/json" },
		method: "POST",
	});
	if (!created.ok) throw errorFor(created);
	const body: unknown = await created.json();
	if (
		!body ||
		typeof body !== "object" ||
		!("id" in body) ||
		typeof body.id !== "string"
	) {
		throw new DidunyError("request_rejected");
	}
	const uploaded = await request(`${path}/${body.id}/media`, {
		body: audio,
		credentials: "include",
		headers: { "content-type": audio.type || "audio/webm" },
		method: "PUT",
	});
	if (!uploaded.ok) throw errorFor(uploaded);
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
