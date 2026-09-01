import type { Recording } from "./models";
import type {
	AudioBytes,
	HttpPort,
	HttpRequest,
	HttpResponse,
	Platform,
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
	const blobs = new Map<string, AudioBytes>();
	const recordings = new Map<string, Recording>();
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
		blobs: {
			isAvailable: true,
			async delete(ids) {
				for (const id of ids) blobs.delete(id);
			},
			async read(id) {
				return blobs.get(id) ?? unavailable(`blob ${id}`);
			},
			async write(id, bytes) {
				blobs.set(id, bytes);
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
		logger: { error() {}, info() {} },
		metadata: {
			isAvailable: true,
			async deleteRecordings(ids) {
				for (const id of ids) recordings.delete(id);
			},
			async loadAll() {
				return [...recordings.values()];
			},
			async upsertRecording(recording) {
				recordings.set(recording.id, recording);
			},
		},
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
