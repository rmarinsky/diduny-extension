import type { Database as BunDatabase } from "bun:sqlite";
import { createWriteStream } from "node:fs";
import {
	mkdir,
	readdir,
	rename,
	stat,
	statfs,
	unlink as unlinkFile,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import {
	type ProcessingStatus,
	type Recording,
	type RecordingType,
	type TranscriptKind,
	type TranscriptVersion,
	cleanDictationText,
	displayRecordingText,
	timeSavedSecondsForWords,
	wordCount,
} from "../core/models";
import type {
	LibraryAudio,
	LibraryDetail,
	LibraryListOptions,
	LibraryMedia,
	LibraryMetadata,
	LibraryPage,
	LibraryPort,
	NewLibraryRecording,
	RecordingSummary,
	RetentionCategory,
	RetentionPolicy,
} from "../core/ports";
import {
	DEFAULT_SETTINGS,
	type Settings,
	normalizeSettings,
	textCleanupFromSettings,
	updateSettings,
} from "../core/settings";

export type {
	LibraryAudio,
	LibraryDetail,
	LibraryListOptions,
	LibraryMetadata,
	LibraryMedia,
	LibraryPage,
	NewLibraryRecording,
	RecordingSummary,
	RetentionCategory,
	RetentionPolicy,
} from "../core/ports";

const require = createRequire(import.meta.url);
const millisecondsPerDay = 24 * 60 * 60 * 1000;
const retentionDurations = {
	days7: 7 * millisecondsPerDay,
	days30: 30 * millisecondsPerDay,
	days90: 90 * millisecondsPerDay,
	forever: null,
	never: null,
	year1: 365 * millisecondsPerDay,
} as const;
const mediaExtensions = new Set(["ogg", "opus", "wav", "webm"]);

type SqlValue = null | number | string;

function openDatabase(path: string): BunDatabase {
	const { Database } = require("bun:sqlite") as {
		Database: new (filename: string) => BunDatabase;
	};
	return new Database(path);
}

export interface LibraryMediaFile {
	contentType: string;
	fileName: string;
	fileSizeBytes: number;
	path: string;
}

export interface LibraryExportEntry {
	media: LibraryMediaFile | null;
	recording: LibraryDetail;
}

export interface LibraryStorageStats {
	dataDir: string;
	freeBytes: number;
	usedBytes: number;
}

export interface LibraryUsageStats {
	dictationDurationSeconds: number;
	recordingCount: number;
	timeSavedSeconds: number | null;
	wordCount: number;
}

export interface LibraryStoreOptions {
	dataDir: string;
	log?: (event: string, fields: Readonly<Record<string, number>>) => void;
	sweepEveryMs?: number;
	unlink?: (path: string) => Promise<void>;
}

type RecordingRow = {
	audioFileName: string;
	createdAt: number;
	description: string | null;
	durationSeconds: number;
	fileSizeBytes: number;
	id: string;
	provider: string | null;
	status: ProcessingStatus;
	text: string;
	title: string | null;
	type: RecordingType;
};

type TranscriptRow = {
	createdAt: number;
	id: string;
	isCurrent: number;
	kind: TranscriptKind;
	provider: string | null;
	text: string;
};

type SegmentRow = {
	endMilliseconds: number | null;
	ordinal: number;
	speaker: string | null;
	startMilliseconds: number;
	text: string;
};

type SummaryRow = {
	createdAt: number;
	durationSeconds: number;
	hasTranslation: number;
	id: string;
	snippet: string | null;
	status: ProcessingStatus;
	title: string | null;
	type: RecordingType;
};

type FileRow = {
	audioFileName: string;
	description: string | null;
	id: string;
	text: string;
	title: string | null;
};

type MetadataRow = {
	description: string | null;
	text: string;
	title: string | null;
};

type StatisticsRow = {
	durationSeconds: number;
	text: string;
	type: RecordingType;
};

function isRecordingId(value: string) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		value,
	);
}

function isSafeMediaName(value: string) {
	const [id, extension] = value.split(".", 2);
	return Boolean(
		id && extension && isRecordingId(id) && mediaExtensions.has(extension),
	);
}

function mediaExtension(contentType: string) {
	const normalized = contentType.toLowerCase();
	if (normalized.includes("webm")) return "webm";
	if (normalized.includes("ogg")) return "ogg";
	if (normalized.includes("opus")) return "opus";
	if (normalized.includes("wav")) return "wav";
	return "webm";
}

function mediaContentType(fileName: string) {
	if (fileName.endsWith(".ogg")) return "audio/ogg";
	if (fileName.endsWith(".opus")) return "audio/ogg; codecs=opus";
	if (fileName.endsWith(".wav")) return "audio/wav";
	return "audio/webm";
}

function categoryFor(type: RecordingType): RetentionCategory {
	return type === "meeting" || type === "meetingTranslation"
		? "meeting"
		: "dictation";
}

function quotedFtsQuery(value: string) {
	return value
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((term) => `"${term.replaceAll('"', '""')}"`)
		.join(" AND ");
}

function currentTranscript(history: readonly TranscriptVersion[]) {
	return history[0];
}

async function directoryBytes(path: string): Promise<number> {
	let total = 0;
	for (const entry of await readdir(path, { withFileTypes: true })) {
		const child = join(path, entry.name);
		if (entry.isDirectory()) total += await directoryBytes(child);
		else if (entry.isFile()) total += (await stat(child)).size;
	}
	return total;
}

export class LibraryStore implements LibraryPort {
	readonly batches: LibraryPort["batches"];
	readonly isAvailable = true;
	readonly maintenance: LibraryPort["maintenance"];
	private readonly database: BunDatabase;
	private readonly dataDir: string;
	private readonly log: (
		event: string,
		fields: Readonly<Record<string, number>>,
	) => void;
	private readonly recordingsDir: string;
	private readonly unlink: (path: string) => Promise<void>;
	private sweepTimer: ReturnType<typeof setInterval> | undefined;

	private constructor(options: LibraryStoreOptions) {
		this.dataDir = resolve(options.dataDir);
		this.recordingsDir = join(this.dataDir, "recordings");
		this.database = openDatabase(join(this.dataDir, "diduny.db"));
		this.log = options.log ?? (() => {});
		this.unlink = options.unlink ?? unlinkFile;
		this.batches = {
			remove: async (id) => {
				const recordings = this.database
					.query<{ id: string }, [string]>(
						"SELECT id FROM recordings WHERE batchId = ?",
					)
					.all(id)
					.map((recording) => recording.id);
				await this.remove(recordings);
				this.database.run("DELETE FROM batches WHERE id = ?", [id]);
				return { removedRecordings: recordings };
			},
		};
		this.maintenance = {
			reconcile: () => this.reconcile(),
			sweepRetention: () => this.sweepRetention(),
		};
	}

	static async open(options: LibraryStoreOptions) {
		const dataDir = resolve(options.dataDir);
		await mkdir(dataDir, { recursive: true });
		await mkdir(join(dataDir, "recordings"), { recursive: true });
		const store = new LibraryStore({ ...options, dataDir });
		try {
			store.migrate();
			await store.sweepRetention();
			store.startSweeper(options.sweepEveryMs ?? 60 * 60 * 1000);
			return store;
		} catch (error) {
			await store.close();
			throw error;
		}
	}

	async close() {
		if (this.sweepTimer) clearInterval(this.sweepTimer);
		this.database.close();
	}

	async getRetentionPolicies(): Promise<
		Record<RetentionCategory, RetentionPolicy>
	> {
		return {
			dictation: this.getRetentionPolicy("dictation"),
			meeting: this.getRetentionPolicy("meeting"),
		};
	}

	async setRetentionPolicy(
		category: RetentionCategory,
		policy: RetentionPolicy,
	) {
		if (!(policy in retentionDurations))
			throw new Error("invalid retention policy");
		this.database.run(
			`INSERT INTO settings (key, valueJson, updatedAt) VALUES (?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET valueJson = excluded.valueJson, updatedAt = excluded.updatedAt`,
			[`retention:${category}`, JSON.stringify(policy), Date.now()],
		);
	}

	async getWorkspaceSettings(): Promise<Settings> {
		return this.workspaceSettings();
	}

	async updateWorkspaceSettings(changes: Partial<Settings>): Promise<Settings> {
		const settings = updateSettings(this.workspaceSettings(), changes);
		this.database.run(
			`INSERT INTO settings (key, valueJson, updatedAt) VALUES (?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET valueJson = excluded.valueJson, updatedAt = excluded.updatedAt`,
			["workspace", JSON.stringify(settings), Date.now()],
		);
		return settings;
	}

	async getStorageStats(): Promise<LibraryStorageStats> {
		const [usedBytes, filesystem] = await Promise.all([
			directoryBytes(this.dataDir),
			statfs(this.dataDir),
		]);
		return {
			dataDir: this.dataDir,
			freeBytes: Number(filesystem.bavail) * Number(filesystem.bsize),
			usedBytes,
		};
	}

	async getUsageStats(): Promise<LibraryUsageStats> {
		const rows = this.database
			.query<StatisticsRow, []>(
				"SELECT type, durationSeconds, transcriptionText AS text FROM recordings",
			)
			.all();
		const dictations = rows.filter(
			(row) => row.type === "voice" || row.type === "translation",
		);
		const settings = this.workspaceSettings();
		const cleanup = textCleanupFromSettings(settings);
		const totalWords = dictations.reduce(
			(total, row) => total + wordCount(cleanDictationText(row.text, cleanup)),
			0,
		);
		const dictationDurationSeconds = dictations.reduce(
			(total, row) => total + row.durationSeconds,
			0,
		);
		return {
			dictationDurationSeconds,
			recordingCount: rows.length,
			timeSavedSeconds: timeSavedSecondsForWords(
				totalWords,
				dictationDurationSeconds,
				settings.typingSpeedWordsPerMinute,
			),
			wordCount: totalWords,
		};
	}

	async save(recording: NewLibraryRecording, audio: LibraryAudio) {
		if (this.getRetentionPolicy(categoryFor(recording.type)) === "never") {
			return null;
		}
		const id = crypto.randomUUID();
		const fileName = `${id}.${mediaExtension(audio.contentType)}`;
		const path = this.safeMediaPath(fileName);
		if (!path) throw new Error("unsafe generated media name");
		await writeFile(path, audio.bytes);
		try {
			this.insertRecording(id, fileName, audio.bytes.byteLength, recording);
			return await this.open(id);
		} catch (error) {
			await this.unlink(path).catch(() => undefined);
			throw error;
		}
	}

	async saveStaged(
		recording: NewLibraryRecording,
		stagedPath: string,
		contentType: string,
	) {
		if (this.getRetentionPolicy(categoryFor(recording.type)) === "never") {
			await this.unlink(stagedPath).catch(() => undefined);
			return null;
		}
		const id = crypto.randomUUID();
		const fileName = `${id}.${mediaExtension(contentType)}`;
		const targetPath = this.safeMediaPath(fileName);
		if (!targetPath) throw new Error("unsafe generated media name");
		const file = await stat(stagedPath);
		await rename(stagedPath, targetPath);
		try {
			this.insertRecording(id, fileName, file.size, recording);
			return await this.open(id);
		} catch (error) {
			await this.unlink(targetPath).catch(() => undefined);
			throw error;
		}
	}

	async saveStream(
		recording: NewLibraryRecording,
		stream: NodeJS.ReadableStream,
		contentType: string,
	) {
		if (this.getRetentionPolicy(categoryFor(recording.type)) === "never") {
			for await (const _chunk of stream) {
				// Consume the request without writing a file for the `never` policy.
			}
			return null;
		}
		const stagedPath = join(
			this.recordingsDir,
			`.${crypto.randomUUID()}.upload`,
		);
		try {
			await pipeline(stream, createWriteStream(stagedPath));
			return await this.saveStaged(recording, stagedPath, contentType);
		} finally {
			await this.unlink(stagedPath).catch(() => undefined);
		}
	}

	async list(options: LibraryListOptions = {}): Promise<LibraryPage> {
		const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
		const offset = Math.max(options.offset ?? 0, 0);
		const params: SqlValue[] = [];
		const filters = this.filters(options, params, "r");
		const search = options.search?.trim();
		const sql = search
			? `SELECT r.id, r.createdAt, r.type, r.status, r.durationSeconds, r.title,
					EXISTS(SELECT 1 FROM transcript_versions tv WHERE tv.recordingId = r.id AND tv.kind = 'translation') AS hasTranslation,
					snippet(recordings_fts, 0, '', '', '…', 12) AS snippet
				FROM recordings_fts
				JOIN recordings_fts_map m ON m.rowid = recordings_fts.rowid
				JOIN recordings r ON r.id = m.recordingId
				WHERE recordings_fts MATCH ?${filters}
				ORDER BY r.createdAt DESC LIMIT ? OFFSET ?`
			: `SELECT r.id, r.createdAt, r.type, r.status, r.durationSeconds, r.title,
					EXISTS(SELECT 1 FROM transcript_versions tv WHERE tv.recordingId = r.id AND tv.kind = 'translation') AS hasTranslation,
					NULL AS snippet
				FROM recordings r WHERE 1=1${filters}
				ORDER BY r.createdAt DESC LIMIT ? OFFSET ?`;
		const values = search
			? [quotedFtsQuery(search), ...params, limit, offset]
			: [...params, limit, offset];
		const rows = this.database
			.query<SummaryRow, SqlValue[]>(sql)
			.all(...values);
		const items = rows.map((row) => ({
			createdAt: row.createdAt,
			displayTitle: row.title?.trim() || "Untitled recording",
			durationSeconds: row.durationSeconds,
			hasTranslation: row.hasTranslation === 1,
			id: row.id,
			...(search && row.snippet ? { snippet: row.snippet } : {}),
			status: row.status,
			type: row.type,
		}));
		return {
			items,
			...(rows.length === limit ? { nextOffset: offset + rows.length } : {}),
		};
	}

	async open(id: string): Promise<LibraryDetail | null> {
		if (!isRecordingId(id)) return null;
		const row = this.database
			.query<RecordingRow, [string]>(
				`SELECT id, createdAt, type, status, audioFileName, durationSeconds, fileSizeBytes,
					transcriptionText AS text, title, description, provider
				 FROM recordings WHERE id = ?`,
			)
			.get(id);
		if (!row) return null;
		const historyRows = this.database
			.query<TranscriptRow, [string]>(
				`SELECT id, createdAt, kind, provider, text, isCurrent
				 FROM transcript_versions WHERE recordingId = ?
				 ORDER BY isCurrent DESC, createdAt DESC`,
			)
			.all(id);
		const history: TranscriptVersion[] = [];
		for (const version of historyRows) {
			const segments = this.database
				.query<SegmentRow, [string]>(
					`SELECT ordinal, startMilliseconds, endMilliseconds, speaker, text
					 FROM segments WHERE transcriptVersionId = ? ORDER BY ordinal`,
				)
				.all(version.id)
				.map((segment) => ({
					endMs: segment.endMilliseconds ?? segment.startMilliseconds,
					...(segment.speaker ? { speaker: segment.speaker } : {}),
					startMs: segment.startMilliseconds,
					text: segment.text,
				}));
			history.push({
				createdAt: version.createdAt,
				id: version.id,
				kind: version.kind,
				provider: version.provider ?? "unknown",
				...(segments.length ? { segments } : {}),
				text: version.text,
			});
		}
		const current = currentTranscript(history);
		const recording: Recording = {
			createdAt: row.createdAt,
			id: row.id,
			...(row.provider ? { provider: row.provider } : {}),
			...(current?.segments ? { segments: current.segments } : {}),
			status: row.status,
			text: current?.text ?? row.text,
			...(row.title ? { title: row.title } : {}),
			type: row.type,
		};
		return {
			...recording,
			...(row.description ? { description: row.description } : {}),
			displayText: displayRecordingText(
				recording,
				textCleanupFromSettings(this.workspaceSettings()),
			),
			durationSeconds: row.durationSeconds,
			history,
			media: {
				contentType: mediaContentType(row.audioFileName),
				fileName: row.audioFileName,
				fileSizeBytes: row.fileSizeBytes,
				id: row.id,
			},
		};
	}

	async remove(ids: readonly string[]) {
		const knownIds = [...new Set(ids.filter(isRecordingId))];
		if (!knownIds.length) return;
		const placeholders = knownIds.map(() => "?").join(", ");
		const rows = this.database
			.query<FileRow, string[]>(
				`SELECT id, audioFileName, transcriptionText AS text, title, description
				 FROM recordings WHERE id IN (${placeholders})`,
			)
			.all(...knownIds);
		this.database.exec("BEGIN IMMEDIATE");
		try {
			for (const row of rows) {
				const fts = this.database
					.query<{ rowid: number }, [string]>(
						"SELECT rowid FROM recordings_fts_map WHERE recordingId = ?",
					)
					.get(row.id);
				if (fts) {
					this.database.run(
						`INSERT INTO recordings_fts(recordings_fts, rowid, text, title, description)
						 VALUES ('delete', ?, ?, ?, ?)`,
						[fts.rowid, row.text, row.title ?? "", row.description ?? ""],
					);
				}
			}
			this.database.run(
				`DELETE FROM recordings WHERE id IN (${placeholders})`,
				knownIds,
			);
			this.database.exec("COMMIT");
		} catch (error) {
			this.database.exec("ROLLBACK");
			throw error;
		}
		let unlinkFailures = 0;
		for (const row of rows) {
			const path = this.safeMediaPath(row.audioFileName);
			if (!path) continue;
			try {
				await this.unlink(path);
			} catch (error) {
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT"
					)
				) {
					unlinkFailures += 1;
				}
			}
		}
		this.log("library.remove", { records: rows.length, unlinkFailures });
	}

	async updateMetadata(id: string, metadata: LibraryMetadata) {
		if (!isRecordingId(id)) return null;
		const row = this.database
			.query<MetadataRow, [string]>(
				"SELECT transcriptionText AS text, title, description FROM recordings WHERE id = ?",
			)
			.get(id);
		if (!row) return null;
		const title = metadata.title === undefined ? row.title : metadata.title;
		const description =
			metadata.description === undefined
				? row.description
				: metadata.description;
		this.database.exec("BEGIN IMMEDIATE");
		try {
			const fts = this.database
				.query<{ rowid: number }, [string]>(
					"SELECT rowid FROM recordings_fts_map WHERE recordingId = ?",
				)
				.get(id);
			if (fts) {
				this.database.run(
					`INSERT INTO recordings_fts(recordings_fts, rowid, text, title, description)
					 VALUES ('delete', ?, ?, ?, ?)`,
					[fts.rowid, row.text, row.title ?? "", row.description ?? ""],
				);
			}
			this.database.run(
				"UPDATE recordings SET title = ?, description = ? WHERE id = ?",
				[title, description, id],
			);
			if (fts) {
				this.database.run(
					"INSERT INTO recordings_fts (rowid, text, title, description) VALUES (?, ?, ?, ?)",
					[fts.rowid, row.text, title ?? "", description ?? ""],
				);
			}
			this.database.exec("COMMIT");
		} catch (error) {
			this.database.exec("ROLLBACK");
			throw error;
		}
		return this.open(id);
	}

	async reconcile() {
		const known = new Set(
			this.database
				.query<{ audioFileName: string }, []>(
					"SELECT audioFileName FROM recordings",
				)
				.all()
				.map((row) => row.audioFileName),
		);
		let removedOrphans = 0;
		for (const fileName of await readdir(this.recordingsDir)) {
			const isInterruptedUpload = /^\.[0-9a-f-]{36}\.upload$/i.test(fileName);
			if (
				known.has(fileName) ||
				(!isSafeMediaName(fileName) && !isInterruptedUpload)
			) {
				continue;
			}
			await this.unlink(join(this.recordingsDir, fileName)).catch(
				() => undefined,
			);
			removedOrphans += 1;
		}
		this.log("library.reconcile", { removedOrphans });
		return { removedOrphans };
	}

	async sweepRetention() {
		let removed = 0;
		for (const category of ["dictation", "meeting"] as const) {
			const policy = this.getRetentionPolicy(category);
			const duration = retentionDurations[policy];
			if (duration === null) continue;
			const types =
				category === "meeting"
					? ["meeting", "meetingTranslation"]
					: ["voice", "translation", "fileTranscription"];
			const ids = this.database
				.query<{ id: string }, SqlValue[]>(
					`SELECT id FROM recordings
					 WHERE type IN (${types.map(() => "?").join(", ")}) AND createdAt < ?`,
				)
				.all(...types, Date.now() - duration)
				.map((row) => row.id);
			await this.remove(ids);
			removed += ids.length;
		}
		this.database.exec("PRAGMA optimize");
		this.log("library.sweep", { removed });
		return { removed };
	}

	async media(id: string): Promise<LibraryMediaFile | null> {
		if (!isRecordingId(id)) return null;
		const row = this.database
			.query<{ audioFileName: string; fileSizeBytes: number }, [string]>(
				"SELECT audioFileName, fileSizeBytes FROM recordings WHERE id = ?",
			)
			.get(id);
		if (!row) return null;
		const path = this.safeMediaPath(row.audioFileName);
		if (!path) return null;
		try {
			await stat(path);
			return {
				contentType: mediaContentType(row.audioFileName),
				fileName: row.audioFileName,
				fileSizeBytes: row.fileSizeBytes,
				path,
			};
		} catch {
			return null;
		}
	}

	async *exportEntries(): AsyncIterable<LibraryExportEntry> {
		const ids = this.database
			.query<{ id: string }, []>(
				"SELECT id FROM recordings ORDER BY createdAt ASC, id ASC",
			)
			.all()
			.map((row) => row.id);
		for (const id of ids) {
			const recording = await this.open(id);
			if (!recording) continue;
			yield { media: await this.media(id), recording };
		}
	}

	private filters(
		options: LibraryListOptions,
		params: SqlValue[],
		alias: string,
	) {
		let sql = "";
		if (options.type?.length) {
			sql += ` AND ${alias}.type IN (${options.type.map(() => "?").join(", ")})`;
			params.push(...options.type);
		}
		if (options.status?.length) {
			sql += ` AND ${alias}.status IN (${options.status.map(() => "?").join(", ")})`;
			params.push(...options.status);
		}
		return sql;
	}

	private getRetentionPolicy(category: RetentionCategory): RetentionPolicy {
		const row = this.database
			.query<{ valueJson: string }, [string]>(
				"SELECT valueJson FROM settings WHERE key = ?",
			)
			.get(`retention:${category}`);
		if (!row) return "forever";
		try {
			const policy: unknown = JSON.parse(row.valueJson);
			return typeof policy === "string" && policy in retentionDurations
				? (policy as RetentionPolicy)
				: "forever";
		} catch {
			return "forever";
		}
	}

	private workspaceSettings(): Settings {
		const row = this.database
			.query<{ valueJson: string }, [string]>(
				"SELECT valueJson FROM settings WHERE key = ?",
			)
			.get("workspace");
		if (!row) return DEFAULT_SETTINGS;
		try {
			return normalizeSettings(JSON.parse(row.valueJson));
		} catch {
			return DEFAULT_SETTINGS;
		}
	}

	private insertRecording(
		id: string,
		fileName: string,
		fileSizeBytes: number,
		recording: NewLibraryRecording,
	) {
		const createdAt = recording.createdAt ?? Date.now();
		const versionId = crypto.randomUUID();
		this.database.exec("BEGIN IMMEDIATE");
		try {
			this.database.run(
				`INSERT INTO recordings (
					id, createdAt, type, status, audioFileName, durationSeconds, fileSizeBytes,
					transcriptionText, title, description, processedAt, provider
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					id,
					createdAt,
					recording.type,
					recording.status,
					fileName,
					recording.durationSeconds,
					fileSizeBytes,
					recording.text,
					recording.title ?? null,
					recording.description ?? null,
					createdAt,
					recording.provider ?? "cloud",
				],
			);
			this.database.run(
				`INSERT INTO transcript_versions (
					id, recordingId, createdAt, kind, provider, text, isCurrent
				) VALUES (?, ?, ?, ?, ?, ?, 1)`,
				[
					versionId,
					id,
					createdAt,
					recording.type === "translation" ? "translation" : "cloud",
					recording.provider ?? "cloud",
					recording.text,
				],
			);
			for (const [ordinal, segment] of (recording.segments ?? []).entries()) {
				this.database.run(
					`INSERT INTO segments (
						transcriptVersionId, ordinal, startMilliseconds, endMilliseconds, speaker, text
					) VALUES (?, ?, ?, ?, ?, ?)`,
					[
						versionId,
						ordinal,
						segment.startMs,
						segment.endMs,
						segment.speaker ?? null,
						segment.text,
					],
				);
			}
			const mapped = this.database.run(
				"INSERT INTO recordings_fts_map (recordingId) VALUES (?)",
				[id],
			);
			this.database.run(
				"INSERT INTO recordings_fts (rowid, text, title, description) VALUES (?, ?, ?, ?)",
				[
					Number(mapped.lastInsertRowid),
					recording.text,
					recording.title ?? "",
					recording.description ?? "",
				],
			);
			this.database.exec("COMMIT");
		} catch (error) {
			this.database.exec("ROLLBACK");
			throw error;
		}
	}

	private migrate() {
		this.database.exec("PRAGMA journal_mode = WAL");
		this.database.exec("PRAGMA foreign_keys = ON");
		this.database.exec("PRAGMA busy_timeout = 5000");
		this.database.exec("PRAGMA synchronous = NORMAL");
		this.database.exec(
			"CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL) STRICT",
		);
		const current = this.database
			.query<{ version: number }, []>(
				"SELECT version FROM schema_version LIMIT 1",
			)
			.get();
		if (current && current.version > 1) {
			throw new Error("library database is newer than this Diduny binary");
		}
		if (current) return;
		this.database.exec("BEGIN IMMEDIATE");
		try {
			this.database.exec(`
				CREATE TABLE batches (
					id TEXT PRIMARY KEY,
					createdAt INTEGER NOT NULL,
					status TEXT NOT NULL,
					title TEXT
				) STRICT;
				CREATE TABLE recordings (
					id TEXT PRIMARY KEY CHECK (id GLOB '[0-9a-fA-F-]*' AND length(id) BETWEEN 32 AND 36),
					createdAt INTEGER NOT NULL,
					type TEXT NOT NULL CHECK (type IN ('voice','translation','meeting','meetingTranslation','fileTranscription')),
					status TEXT NOT NULL CHECK (status IN ('unprocessed','processing','transcribed','translated','failed','partiallyRecovered')),
					audioFileName TEXT NOT NULL,
					durationSeconds REAL NOT NULL,
					fileSizeBytes INTEGER NOT NULL,
					transcriptionText TEXT,
					errorMessage TEXT,
					processedAt INTEGER,
					title TEXT,
					description TEXT,
					provider TEXT,
					batchId TEXT REFERENCES batches(id) ON DELETE CASCADE
				) STRICT;
				CREATE TABLE transcript_versions (
					id TEXT PRIMARY KEY,
					recordingId TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
					createdAt INTEGER NOT NULL,
					kind TEXT NOT NULL CHECK (kind IN ('cloud','local','translation')),
					provider TEXT,
					text TEXT NOT NULL,
					isCurrent INTEGER NOT NULL DEFAULT 0 CHECK (isCurrent IN (0,1))
				) STRICT;
				CREATE UNIQUE INDEX ux_transcript_versions_current
					ON transcript_versions(recordingId) WHERE isCurrent = 1;
				CREATE TABLE segments (
					transcriptVersionId TEXT NOT NULL REFERENCES transcript_versions(id) ON DELETE CASCADE,
					ordinal INTEGER NOT NULL,
					startMilliseconds INTEGER NOT NULL,
					endMilliseconds INTEGER,
					speaker TEXT,
					text TEXT NOT NULL,
					PRIMARY KEY (transcriptVersionId, ordinal)
				) STRICT;
				CREATE TABLE chapters (
					id TEXT PRIMARY KEY,
					recordingId TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
					timestampSeconds REAL NOT NULL,
					label TEXT NOT NULL,
					createdAt INTEGER NOT NULL
				) STRICT;
				CREATE TABLE batch_items (
					id TEXT PRIMARY KEY,
					batchId TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
					recordingId TEXT REFERENCES recordings(id) ON DELETE SET NULL,
					status TEXT NOT NULL,
					remoteSourceIdentity TEXT,
					checkpointJson TEXT,
					errorMessage TEXT,
					createdAt INTEGER NOT NULL
				) STRICT;
				CREATE TABLE settings (
					key TEXT PRIMARY KEY,
					valueJson TEXT NOT NULL,
					updatedAt INTEGER NOT NULL
				) STRICT;
				CREATE VIRTUAL TABLE recordings_fts USING fts5(
					text, title, description, content = '', tokenize = 'unicode61 remove_diacritics 2'
				);
				CREATE TABLE recordings_fts_map (
					rowid INTEGER PRIMARY KEY,
					recordingId TEXT NOT NULL UNIQUE REFERENCES recordings(id) ON DELETE CASCADE
				) STRICT;
				CREATE INDEX ix_recordings_createdAt ON recordings(createdAt DESC);
				CREATE INDEX ix_recordings_type ON recordings(type);
				CREATE INDEX ix_recordings_status ON recordings(status);
				CREATE INDEX ix_recordings_batchId ON recordings(batchId);
				CREATE INDEX ix_transcript_versions_recording ON transcript_versions(recordingId, createdAt DESC);
				CREATE INDEX ix_chapters_recording ON chapters(recordingId, timestampSeconds);
				CREATE INDEX ix_batches_createdAt ON batches(createdAt DESC);
				CREATE INDEX ix_batch_items_batch ON batch_items(batchId, status);
				CREATE INDEX ix_batch_items_remote ON batch_items(remoteSourceIdentity);
			`);
			this.database.run("INSERT INTO schema_version (version) VALUES (1)");
			this.database.exec("COMMIT");
		} catch (error) {
			this.database.exec("ROLLBACK");
			throw error;
		}
	}

	private safeMediaPath(fileName: string) {
		return isSafeMediaName(fileName)
			? join(this.recordingsDir, fileName)
			: null;
	}

	private startSweeper(interval: number) {
		if (interval <= 0) return;
		this.sweepTimer = setInterval(() => {
			void this.sweepRetention().catch(() =>
				this.log("library.sweep_failed", {}),
			);
		}, interval);
		this.sweepTimer.unref?.();
	}
}
