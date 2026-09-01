import type { BffLibrary } from "../../server";
import type {
	LibraryDetail,
	LibraryListOptions,
	NewLibraryRecording,
} from "../../src/core/ports";

function summary(recording: LibraryDetail) {
	return {
		createdAt: recording.createdAt,
		displayTitle: recording.title?.trim() || "Untitled recording",
		durationSeconds: recording.durationSeconds,
		hasTranslation: recording.history.some(
			(version) => version.kind === "translation",
		),
		id: recording.id,
		status: recording.status,
		type: recording.type,
	};
}

function matches(recording: LibraryDetail, options: LibraryListOptions) {
	if (options.status?.length && !options.status.includes(recording.status))
		return false;
	if (options.type?.length && !options.type.includes(recording.type))
		return false;
	const search = options.search?.trim().toLocaleLowerCase();
	if (!search) return true;
	return [
		recording.description,
		recording.displayText,
		recording.text,
		recording.title,
	]
		.filter((value): value is string => Boolean(value))
		.some((value) => value.toLocaleLowerCase().includes(search));
}

export function createE2eLibrary(initial: readonly LibraryDetail[] = []) {
	const recordings = new Map(
		initial.map((recording) => [recording.id, recording]),
	);
	const library: BffLibrary = {
		async list(options = {}) {
			const limit = options.limit ?? 50;
			const offset = options.offset ?? 0;
			const items = [...recordings.values()]
				.filter((recording) => matches(recording, options))
				.sort((left, right) => right.createdAt - left.createdAt);
			const page = items.slice(offset, offset + limit).map(summary);
			return {
				items: page,
				...(offset + page.length < items.length
					? { nextOffset: offset + page.length }
					: {}),
			};
		},
		async media() {
			return null;
		},
		async open(id) {
			return recordings.get(id) ?? null;
		},
		async remove(ids) {
			for (const id of ids) recordings.delete(id);
		},
		async saveStream(
			recording: NewLibraryRecording,
			stream: NodeJS.ReadableStream,
			contentType: string,
		) {
			let fileSizeBytes = 0;
			for await (const chunk of stream) {
				fileSizeBytes +=
					typeof chunk === "string"
						? Buffer.byteLength(chunk)
						: chunk.byteLength;
			}
			const id = crypto.randomUUID();
			const createdAt = Date.now();
			const detail: LibraryDetail = {
				createdAt,
				displayText: recording.text,
				durationSeconds: recording.durationSeconds,
				history: [
					{
						createdAt,
						id: `${id}:current`,
						kind: "cloud",
						provider: "e2e",
						text: recording.text,
					},
				],
				id,
				media: {
					contentType,
					fileName: `${id}.webm`,
					fileSizeBytes,
					id,
				},
				status: recording.status,
				text: recording.text,
				type: recording.type,
			};
			recordings.set(id, detail);
			return detail;
		},
		async updateMetadata(id, metadata) {
			const recording = recordings.get(id);
			if (!recording) return null;
			const updated = { ...recording };
			if (metadata.title === null) updated.title = undefined;
			else if (metadata.title !== undefined) updated.title = metadata.title;
			if (metadata.description === null) updated.description = undefined;
			else if (metadata.description !== undefined)
				updated.description = metadata.description;
			recordings.set(id, updated);
			return updated;
		},
	};
	return {
		library,
		savedTexts: () =>
			[...recordings.values()].map((recording) => recording.text),
	};
}
