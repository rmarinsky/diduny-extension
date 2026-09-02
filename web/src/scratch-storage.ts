import { AUDIO_FORMAT } from "../../src/core/constants";
import type { RecordingType, TranscriptSegment } from "../../src/core/models";
import scratchStorageWorkerUrl from "./scratch-storage.worker.ts?worker&url";

export interface ScratchRecording {
	audio: Blob;
	durationSeconds: number;
	id: string;
	segments?: readonly TranscriptSegment[];
	text: string;
	type?: RecordingType;
}

export interface ScratchMetadata {
	segments?: readonly TranscriptSegment[];
	text: string;
	type: RecordingType;
}

type WorkerCommand =
	| { id: string; type: "append-encoded"; bytes: ArrayBuffer }
	| { id: string; type: "append-pcm"; bytes: ArrayBuffer }
	| { id: string; text: string; type: "set-text" }
	| {
			id: string;
			recordingType: RecordingType;
			requestId: number;
			segments?: readonly TranscriptSegment[];
			text: string;
			type: "set-metadata";
	  }
	| { id: string; requestId: number; type: "complete" | "discard" | "flush" }
	| {
			id: string;
			requestId: number;
			sampleRate: number;
			channels: number;
			createdAt: number;
			recordingType?: RecordingType;
			type: "start";
	  }
	| { requestId: number; type: "recover" };

type WorkerResult =
	| { requestId: number; type: "error"; message: string }
	| { requestId: number; type: "result"; value: unknown };

type WorkerRequestCommand =
	| { id: string; type: "complete" | "discard" | "flush" }
	| {
			id: string;
			recordingType: RecordingType;
			segments?: readonly TranscriptSegment[];
			text: string;
			type: "set-metadata";
	  }
	| {
			channels: number;
			createdAt: number;
			id: string;
			recordingType?: RecordingType;
			sampleRate: number;
			type: "start";
	  }
	| { type: "recover" };

interface ScratchWorker {
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<WorkerResult>) => void,
	): void;
	postMessage(message: WorkerCommand, transfer?: Transferable[]): void;
	terminate(): void;
}

export interface ScratchCapture {
	appendEncoded(audio: Blob): Promise<void>;
	appendPcm(frame: Int16Array): void;
	complete(): Promise<ScratchRecording>;
	discard(): Promise<void>;
	flush(): Promise<void>;
	setText(text: string): void;
}

export interface ScratchStorage {
	close(): void;
	discard(id: string): Promise<void>;
	recover(): Promise<readonly ScratchRecording[]>;
	start(recordingType?: RecordingType): Promise<ScratchCapture>;
	updateMetadata(id: string, metadata: ScratchMetadata): Promise<void>;
}

function browserWorker(): ScratchWorker {
	return new Worker(scratchStorageWorkerUrl, {
		type: "module",
	});
}

class BrowserScratchStorage implements ScratchStorage {
	private closed = false;
	private nextRequestId = 0;
	private readonly pending = new Map<
		number,
		{ reject(reason: unknown): void; resolve(value: unknown): void }
	>();

	constructor(private readonly worker: ScratchWorker) {
		worker.addEventListener("message", (event) => {
			const result = event.data;
			if (!result || typeof result !== "object" || !("requestId" in result))
				return;
			const pending = this.pending.get(result.requestId);
			if (!pending) return;
			this.pending.delete(result.requestId);
			if (result.type === "error") {
				pending.reject(new Error(result.message));
				return;
			}
			pending.resolve(result.value);
		});
	}

	async start(recordingType?: RecordingType): Promise<ScratchCapture> {
		const id = crypto.randomUUID();
		await this.request({
			channels: AUDIO_FORMAT.channels,
			createdAt: Date.now(),
			id,
			...(recordingType ? { recordingType } : {}),
			sampleRate: AUDIO_FORMAT.sampleRate,
			type: "start",
		});
		return new BrowserScratchCapture(this, id);
	}

	updateMetadata(id: string, metadata: ScratchMetadata) {
		return this.request({
			id,
			recordingType: metadata.type,
			...(metadata.segments ? { segments: metadata.segments } : {}),
			text: metadata.text,
			type: "set-metadata",
		}) as Promise<void>;
	}

	recover() {
		return this.request({ type: "recover" }) as Promise<
			readonly ScratchRecording[]
		>;
	}

	discard(id: string) {
		return this.request({ id, type: "discard" }) as Promise<void>;
	}

	close() {
		if (this.closed) return;
		this.closed = true;
		this.worker.terminate();
		for (const pending of this.pending.values())
			pending.reject(new Error("Scratch storage closed"));
		this.pending.clear();
	}

	post(message: WorkerCommand, transfer?: Transferable[]) {
		if (!this.closed) this.worker.postMessage(message, transfer);
	}

	request(message: WorkerRequestCommand): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error("Scratch storage closed"));
		const requestId = ++this.nextRequestId;
		return new Promise((resolve, reject) => {
			this.pending.set(requestId, { reject, resolve });
			this.worker.postMessage({ ...message, requestId } as WorkerCommand);
		});
	}
}

class BrowserScratchCapture implements ScratchCapture {
	private stopped = false;

	constructor(
		private readonly storage: BrowserScratchStorage,
		private readonly id: string,
	) {}

	appendPcm(frame: Int16Array) {
		if (this.stopped) return;
		const bytes = frame.slice().buffer;
		this.storage.post({ bytes, id: this.id, type: "append-pcm" }, [bytes]);
	}

	async appendEncoded(audio: Blob) {
		const bytes = await audio.arrayBuffer();
		if (this.stopped) return;
		this.storage.post({ bytes, id: this.id, type: "append-encoded" }, [bytes]);
	}

	flush() {
		return this.storage.request({
			id: this.id,
			type: "flush",
		}) as Promise<void>;
	}

	complete() {
		this.stopped = true;
		return this.storage.request({
			id: this.id,
			type: "complete",
		}) as Promise<ScratchRecording>;
	}

	discard() {
		this.stopped = true;
		return this.storage.request({
			id: this.id,
			type: "discard",
		}) as Promise<void>;
	}

	setText(text: string) {
		if (!this.stopped)
			this.storage.post({ id: this.id, text, type: "set-text" });
	}
}

export function createScratchStorage(): ScratchStorage {
	return new BrowserScratchStorage(browserWorker());
}
