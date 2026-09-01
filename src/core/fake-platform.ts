import type { TranscriptVersion } from "./models";
import type {
	HttpPort,
	HttpRequest,
	HttpResponse,
	LibraryDetail,
	NewLibraryRecording,
	Platform,
	RetentionCategory,
	RetentionPolicy,
} from "./ports";
import { DEFAULT_SETTINGS, type Settings } from "./settings";

export interface FakeHttpPort extends HttpPort {
	readonly requests: HttpRequest[];
}

function unavailable(name: string): never {
	throw new Error(`${name} is unavailable on this platform`);
}

export function createFakePlatform(): Platform & { http: FakeHttpPort } {
	let settings: Settings = DEFAULT_SETTINGS;
	const recordings = new Map<string, LibraryDetail>();
	const retention = new Map<RetentionCategory, RetentionPolicy>([
		["dictation", "forever"],
		["meeting", "forever"],
	]);
	const requests: HttpRequest[] = [];
	const http: FakeHttpPort = {
		isAvailable: true,
		requests,
		async send(request): Promise<HttpResponse> {
			requests.push(request);
			return { body: new Uint8Array(), headers: {}, status: 200 };
		},
	};

	return {
		audio: {
			isAvailable: true,
			cancel() {},
			onLevel() {
				return () => {};
			},
			onPcmFrame() {
				return () => {};
			},
			async start() {},
			async stop() {
				return new Uint8Array();
			},
		},
		clock: { now: () => 0 },
		clipboard: {
			canPaste: false,
			isAvailable: true,
			async copy() {},
			async paste() {
				unavailable("clipboard paste");
			},
		},
		devices: {
			isAvailable: true,
			async getDefault() {
				return null;
			},
			async list() {
				return [];
			},
			async resolve() {
				return { device: null, didFallback: false };
			},
		},
		hotkeys: {
			isAvailable: false,
			async register() {},
			async unregisterAll() {},
		},
		http,
		inference: {
			isAvailable: false,
			async transcribe() {
				return unavailable("local inference");
			},
		},
		keyEvents: { isAvailable: false, async start() {}, async stop() {} },
		library: {
			batches: {
				async remove() {
					return { removedRecordings: [] };
				},
			},
			isAvailable: true,
			maintenance: {
				async reconcile() {
					return { removedOrphans: 0 };
				},
				async sweepRetention() {
					return { removed: 0 };
				},
			},
			async getRetentionPolicies() {
				return {
					dictation: retention.get("dictation") ?? "forever",
					meeting: retention.get("meeting") ?? "forever",
				};
			},
			async list(options) {
				const matches = [...recordings.values()]
					.filter((recording) => {
						if (
							options?.type?.length &&
							!options.type.includes(recording.type)
						) {
							return false;
						}
						if (
							options?.status?.length &&
							!options.status.includes(recording.status)
						) {
							return false;
						}
						return (
							!options?.search || recording.displayText.includes(options.search)
						);
					})
					.sort((left, right) => right.createdAt - left.createdAt);
				const offset = options?.offset ?? 0;
				const limit = options?.limit ?? 50;
				return {
					items: matches.slice(offset, offset + limit).map((recording) => ({
						createdAt: recording.createdAt,
						displayTitle: "Untitled recording",
						durationSeconds: recording.durationSeconds,
						hasTranslation: recording.history.some(
							(version) => version.kind === "translation",
						),
						id: recording.id,
						status: recording.status,
						type: recording.type,
					})),
				};
			},
			async open(id) {
				return recordings.get(id) ?? null;
			},
			async remove(ids) {
				for (const id of ids) recordings.delete(id);
			},
			async save(recording: NewLibraryRecording, audio) {
				const category =
					recording.type === "meeting" ||
					recording.type === "meetingTranslation"
						? "meeting"
						: "dictation";
				if (retention.get(category) === "never") return null;
				const id = crypto.randomUUID();
				const createdAt = recording.createdAt ?? 0;
				const history: readonly TranscriptVersion[] = [
					{
						createdAt,
						id: `${id}:current`,
						kind: recording.type === "translation" ? "translation" : "cloud",
						provider: recording.provider ?? "fake",
						...(recording.segments ? { segments: recording.segments } : {}),
						text: recording.text,
					},
				];
				const detail: LibraryDetail = {
					createdAt,
					displayText: recording.text,
					durationSeconds: recording.durationSeconds,
					history,
					id,
					media: {
						contentType: audio.contentType,
						fileName: `${id}.webm`,
						fileSizeBytes: audio.bytes.byteLength,
						id,
					},
					...(recording.provider ? { provider: recording.provider } : {}),
					...(recording.segments ? { segments: recording.segments } : {}),
					status: recording.status,
					text: recording.text,
					type: recording.type,
				};
				recordings.set(id, detail);
				return detail;
			},
			async setRetentionPolicy(category, policy) {
				retention.set(category, policy);
			},
		},
		logger: { error() {}, info() {} },
		permissions: {
			isAvailable: true,
			async request() {
				return "granted";
			},
			async status() {
				return "prompt";
			},
		},
		power: { isAvailable: false, preventSleep: () => ({ dispose() {} }) },
		remoteMedia: {
			canAcquire: false,
			isAvailable: false,
			async acquire() {
				return unavailable("remote media");
			},
		},
		secrets: {
			isAvailable: false,
			async delete() {},
			async read() {
				return null;
			},
			async save() {
				unavailable("secrets");
			},
		},
		settings: {
			isAvailable: true,
			get: () => settings,
			async set(next) {
				settings = next;
			},
		},
		systemAudio: {
			isAvailable: false,
			async cancel() {},
			async start() {
				unavailable("system audio");
			},
			async stop() {
				return null;
			},
		},
		updater: { isAvailable: false, async checkNow() {} },
	};
}
