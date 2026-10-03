import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BffLibrary } from "../../server";
import {
	cleanDictationText,
	displayRecordingText,
	wordCount,
} from "../../src/core/models";
import type {
	LibraryDetail,
	LibraryListOptions,
	NewLibraryRecording,
	RetentionCategory,
	RetentionPolicy,
} from "../../src/core/ports";
import {
	DEFAULT_SETTINGS,
	type Settings,
	textCleanupFromSettings,
	updateSettings,
} from "../../src/core/settings";

export interface WorkspaceLibraryOptions {
	recordings?: readonly LibraryDetail[];
	retention?: Partial<Record<RetentionCategory, RetentionPolicy>>;
	settings?: Partial<Settings>;
}

/** A transcribed library recording with one current transcript version. */
export function seededRecording({
	createdAt = Date.now(),
	durationSeconds = 3,
	id,
	status = "transcribed",
	text,
	title,
	type = "voice",
}: {
	createdAt?: number;
	durationSeconds?: number;
	id: string;
	status?: LibraryDetail["status"];
	text: string;
	title?: string;
	type?: LibraryDetail["type"];
}): LibraryDetail {
	return {
		createdAt,
		displayText: text,
		durationSeconds,
		history: [
			{
				createdAt,
				id: `${id}:current`,
				kind: "cloud",
				provider: "cloud",
				text,
			},
		],
		id,
		media: {
			contentType: "audio/webm",
			fileName: `${id}.webm`,
			fileSizeBytes: 16,
			id,
		},
		status,
		text,
		...(title ? { title } : {}),
		type,
	};
}

function categoryFor(type: LibraryDetail["type"]): RetentionCategory {
	return type === "meeting" || type === "meetingTranslation"
		? "meeting"
		: "dictation";
}

function matches(recording: LibraryDetail, options: LibraryListOptions) {
	if (options.status?.length && !options.status.includes(recording.status))
		return false;
	if (options.type?.length && !options.type.includes(recording.type))
		return false;
	const search = options.search?.trim().toLocaleLowerCase();
	if (!search) return true;
	return [recording.description, recording.text, recording.title]
		.filter((value): value is string => Boolean(value))
		.some((value) => value.toLocaleLowerCase().includes(search));
}

/**
 * An in-memory library that behaves like src/server/library-store.ts where the
 * web specs can see it: the `never` policy saves nothing, Library text and
 * statistics follow the cleanup settings, uploaded audio can be played back,
 * and the export lists every recording. LibraryStore itself needs bun:sqlite,
 * which the Playwright runner (Node) cannot load.
 */
export function createWorkspaceLibrary({
	recordings: initial = [],
	retention: initialRetention = {},
	settings: initialSettings = {},
}: WorkspaceLibraryOptions = {}) {
	const mediaDir = mkdtempSync(join(tmpdir(), "diduny-workspace-e2e-"));
	const recordings = new Map(
		initial.map((recording) => [recording.id, recording]),
	);
	const mediaPaths = new Map<string, string>();
	for (const recording of initial) {
		// Seeded recordings get a placeholder file so export and media routes find one.
		const path = join(mediaDir, recording.media.fileName);
		writeFileSync(path, Buffer.alloc(recording.media.fileSizeBytes));
		mediaPaths.set(recording.id, path);
	}
	let settings = updateSettings(DEFAULT_SETTINGS, initialSettings);
	const retention: Record<RetentionCategory, RetentionPolicy> = {
		dictation: "forever",
		meeting: "forever",
		...initialRetention,
	};

	const withDisplayText = (recording: LibraryDetail): LibraryDetail => ({
		...recording,
		displayText: displayRecordingText(
			recording,
			textCleanupFromSettings(settings),
		),
	});

	const mediaFile = (id: string) => {
		const recording = recordings.get(id);
		const path = mediaPaths.get(id);
		if (!recording || !path) return null;
		return {
			contentType: recording.media.contentType,
			fileName: recording.media.fileName,
			fileSizeBytes: recording.media.fileSizeBytes,
			path,
		};
	};

	const library: BffLibrary = {
		async *exportEntries() {
			const ordered = [...recordings.values()].sort(
				(left, right) => left.createdAt - right.createdAt,
			);
			for (const recording of ordered) {
				yield {
					media: mediaFile(recording.id),
					recording: withDisplayText(recording),
				};
			}
		},
		async getRetentionPolicies() {
			return { ...retention };
		},
		async getStorageStats() {
			return { dataDir: "e2e", freeBytes: 0, usedBytes: 0 };
		},
		async getUsageStats() {
			const dictations = [...recordings.values()].filter(
				(recording) =>
					recording.type === "voice" || recording.type === "translation",
			);
			const cleanup = textCleanupFromSettings(settings);
			return {
				dictationDurationSeconds: dictations.reduce(
					(total, recording) => total + recording.durationSeconds,
					0,
				),
				recordingCount: recordings.size,
				timeSavedSeconds: null,
				wordCount: dictations.reduce(
					(total, recording) =>
						total + wordCount(cleanDictationText(recording.text, cleanup)),
					0,
				),
			};
		},
		async getWorkspaceSettings() {
			return settings;
		},
		async list(options = {}) {
			const limit = options.limit ?? 50;
			const offset = options.offset ?? 0;
			const items = [...recordings.values()]
				.filter((recording) => matches(recording, options))
				.sort((left, right) => right.createdAt - left.createdAt);
			const page = items.slice(offset, offset + limit).map((recording) => ({
				createdAt: recording.createdAt,
				displayTitle: recording.title?.trim() || "Untitled recording",
				durationSeconds: recording.durationSeconds,
				hasTranslation: recording.history.some(
					(version) => version.kind === "translation",
				),
				id: recording.id,
				status: recording.status,
				type: recording.type,
			}));
			return {
				items: page,
				...(offset + page.length < items.length
					? { nextOffset: offset + page.length }
					: {}),
			};
		},
		async media(id) {
			return mediaFile(id);
		},
		async open(id) {
			const recording = recordings.get(id);
			return recording ? withDisplayText(recording) : null;
		},
		async remove(ids) {
			for (const id of ids) {
				recordings.delete(id);
				mediaPaths.delete(id);
			}
		},
		async saveStream(
			recording: NewLibraryRecording,
			stream: NodeJS.ReadableStream,
			contentType: string,
		) {
			const chunks: Buffer[] = [];
			for await (const chunk of stream) chunks.push(Buffer.from(chunk));
			if (retention[categoryFor(recording.type)] === "never") return null;
			const bytes = Buffer.concat(chunks);
			const id = crypto.randomUUID();
			const fileName = `${id}.webm`;
			const path = join(mediaDir, fileName);
			writeFileSync(path, bytes);
			mediaPaths.set(id, path);
			const createdAt = recording.createdAt ?? Date.now();
			const detail: LibraryDetail = {
				createdAt,
				displayText: recording.text,
				durationSeconds: recording.durationSeconds,
				history: [
					{
						createdAt,
						id: `${id}:current`,
						kind: "cloud",
						provider: recording.provider ?? "cloud",
						text: recording.text,
					},
				],
				id,
				media: { contentType, fileName, fileSizeBytes: bytes.byteLength, id },
				status: recording.status,
				text: recording.text,
				type: recording.type,
				...(recording.segments ? { segments: recording.segments } : {}),
			};
			recordings.set(id, detail);
			return withDisplayText(detail);
		},
		async setRetentionPolicy(category, policy) {
			retention[category] = policy;
		},
		async updateWorkspaceSettings(changes) {
			settings = updateSettings(settings, changes);
			return settings;
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
			return withDisplayText(updated);
		},
	};

	return {
		close: () => rmSync(mediaDir, { force: true, recursive: true }),
		library,
		recordings: () => [...recordings.values()],
		retention: () => ({ ...retention }),
		settings: () => settings,
	};
}

export type WorkspaceLibrary = ReturnType<typeof createWorkspaceLibrary>;
