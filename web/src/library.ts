import {
	type LibraryRequest,
	type LibrarySaveInput,
	saveLibraryRecording,
} from "../../lib/bff/library";

export type { LibraryRequest } from "../../lib/bff/library";

export type WebLibrarySaveInput = Omit<LibrarySaveInput, "type">;

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
