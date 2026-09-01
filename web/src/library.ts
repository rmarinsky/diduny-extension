import {
	type LibraryRequest,
	type LibrarySaveInput,
	saveLibraryRecording,
} from "../../lib/bff/library";
import type { ProcessingStatus, RecordingType } from "../../src/core/models";
import type {
	LibraryDetail,
	LibraryMetadata,
	LibraryPage,
} from "../../src/core/ports";

export type { LibraryRequest } from "../../lib/bff/library";

export type WebLibrarySaveInput = Omit<LibrarySaveInput, "type">;

export interface LibraryListInput {
	limit?: number;
	offset?: number;
	search?: string;
	status?: readonly ProcessingStatus[];
	type?: readonly RecordingType[];
}

function errorFor(response: Response, action: string) {
	return new Error(`${action} failed (${response.status})`);
}

const bffRequest: LibraryRequest = (path, init) =>
	fetch(path, { credentials: "same-origin", ...init });

export async function saveToLibrary(
	input: WebLibrarySaveInput,
	request: LibraryRequest = (path, init) => fetch(path, init),
) {
	return saveLibraryRecording(
		{ ...input, type: "voice" },
		"/bff/library",
		request,
	);
}

export async function listLibraryRecordings(
	{ limit, offset, search, status, type }: LibraryListInput = {},
	request: LibraryRequest = bffRequest,
): Promise<LibraryPage> {
	const query = new URLSearchParams();
	if (limit !== undefined) query.set("limit", String(limit));
	if (offset !== undefined) query.set("offset", String(offset));
	if (search?.trim()) query.set("search", search.trim());
	if (status?.length) query.set("status", status.join(","));
	if (type?.length) query.set("type", type.join(","));
	const response = await request(
		`/bff/library${query.size ? `?${query}` : ""}`,
	);
	if (!response.ok) throw errorFor(response, "Library list");
	return response.json() as Promise<LibraryPage>;
}

export async function getLibraryRecording(
	id: string,
	request: LibraryRequest = bffRequest,
): Promise<LibraryDetail> {
	const response = await request(`/bff/library/${id}`);
	if (!response.ok) throw errorFor(response, "Library detail");
	return response.json() as Promise<LibraryDetail>;
}

export async function updateLibraryRecording(
	id: string,
	metadata: LibraryMetadata,
	request: LibraryRequest = bffRequest,
): Promise<LibraryDetail> {
	const response = await request(`/bff/library/${id}`, {
		body: JSON.stringify(metadata),
		headers: { "content-type": "application/json" },
		method: "PATCH",
	});
	if (!response.ok) throw errorFor(response, "Library update");
	return response.json() as Promise<LibraryDetail>;
}

export async function deleteLibraryRecording(
	id: string,
	request: LibraryRequest = bffRequest,
) {
	const response = await request(`/bff/library/${id}`, { method: "DELETE" });
	if (!response.ok) throw errorFor(response, "Library delete");
}
