import { AUDIO_FORMAT } from "../../src/core/constants";
import scratchStorageWorkerUrl from "./scratch-storage.worker.ts?worker&url";

export interface ScratchRecording {
	audio: Blob;
	durationSeconds: number;
	id: string;
	text: string;
}

type WorkerCommand =
	| { id: string; type: "append-encoded"; bytes: ArrayBuffer }
	| { id: string; type: "append-pcm"; bytes: ArrayBuffer }
	| { id: string; text: string; type: "set-text" }
	| { id: string; requestId: number; type: "complete" | "discard" | "flush" }
	| {
			id: string;
			requestId: number;
			sampleRate: number;
			channels: number;
			createdAt: number;
			type: "start";
	  }
	| { requestId: number; type: "recover" };

type WorkerResult =
	| { requestId: number; type: "error"; message: string }
	| { requestId: number; type: "result"; value: unknown };

type WorkerRequestCommand =
	| { id: string; type: "complete" | "discard" | "flush" }
	| {
			channels: number;
			createdAt: number;
			id: string;
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
	start(): Promise<ScratchCapture>;
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

	async start(): Promise<ScratchCapture> {
		const id = crypto.randomUUID();
		await this.request({
			channels: AUDIO_FORMAT.channels,
			createdAt: Date.now(),
			id,
			sampleRate: AUDIO_FORMAT.sampleRate,
			type: "start",
		});
		return new BrowserScratchCapture(this, id);
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
