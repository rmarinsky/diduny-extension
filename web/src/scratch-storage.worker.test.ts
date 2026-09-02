import { expect, test } from "bun:test";

class MemoryFile {
	bytes = new Uint8Array();
	readonly kind = "file";

	async createSyncAccessHandle() {
		return {
			close() {},
			flush() {},
			truncate: (size: number) => {
				this.bytes = this.bytes.slice(0, size);
			},
			write: (data: Uint8Array, options?: { at?: number }) => {
				const offset = options?.at ?? 0;
				const next = new Uint8Array(
					Math.max(this.bytes.byteLength, offset + data.byteLength),
				);
				next.set(this.bytes);
				next.set(data, offset);
				this.bytes = next;
				return data.byteLength;
			},
		};
	}

	async getFile() {
		return new File([this.bytes], "scratch");
	}
}

class MemoryDirectory {
	private readonly directories = new Map<string, MemoryDirectory>();
	private readonly files = new Map<string, MemoryFile>();

	async *entries(): AsyncIterableIterator<[string, { kind: string }]> {
		for (const [name, file] of this.files) yield [name, file];
	}

	async getDirectoryHandle(name: string, options?: { create?: boolean }) {
		const existing = this.directories.get(name);
		if (existing) return existing;
		if (!options?.create) throw new Error(`missing directory ${name}`);
		const created = new MemoryDirectory();
		this.directories.set(name, created);
		return created;
	}

	async getFileHandle(name: string, options?: { create?: boolean }) {
		const existing = this.files.get(name);
		if (existing) return existing;
		if (!options?.create) throw new Error(`missing file ${name}`);
		const created = new MemoryFile();
		this.files.set(name, created);
		return created;
	}

	async removeEntry(name: string) {
		this.files.delete(name);
	}
}

type WorkerReply =
	| { message: string; requestId: number; type: "error" }
	| { requestId: number; type: "result"; value: unknown };

type WorkerHarness = {
	request(command: Record<string, unknown>): Promise<unknown>;
	send(command: Record<string, unknown>): void;
};

test("recovers meeting and translation metadata written before a backend save failure", async () => {
	const root = new MemoryDirectory();
	const originalAddEventListener = globalThis.addEventListener;
	const originalPostMessage = globalThis.postMessage;
	const storageDescriptor = Object.getOwnPropertyDescriptor(
		navigator,
		"storage",
	);
	let listener: ((event: MessageEvent<unknown>) => void) | undefined;
	let replies = new Map<number, (reply: WorkerReply) => void>();

	Object.defineProperty(globalThis, "addEventListener", {
		configurable: true,
		value: (type: string, callback: (event: MessageEvent<unknown>) => void) => {
			if (type === "message") listener = callback;
		},
	});
	Object.defineProperty(globalThis, "postMessage", {
		configurable: true,
		value: (reply: WorkerReply) => replies.get(reply.requestId)?.(reply),
	});
	Object.defineProperty(navigator, "storage", {
		configurable: true,
		value: { getDirectory: async () => root },
	});

	let nextRequestId = 0;
	const loadWorker = async (): Promise<WorkerHarness> => {
		listener = undefined;
		replies = new Map();
		await import(
			`./scratch-storage.worker.ts?recovery-test=${crypto.randomUUID()}`
		);
		if (!listener)
			throw new Error("worker did not register a message listener");
		return {
			request(command) {
				const requestId = ++nextRequestId;
				return new Promise((resolve, reject) => {
					replies.set(requestId, (reply) => {
						replies.delete(requestId);
						if (reply.type === "error") reject(new Error(reply.message));
						else resolve(reply.value);
					});
					listener?.({
						data: { ...command, requestId },
					} as MessageEvent<unknown>);
				});
			},
			send(command) {
				listener?.({ data: command } as MessageEvent<unknown>);
			},
		};
	};

	try {
		const id = "c59c549e-2c1c-4e05-b114-84c293378e45";
		const translationScratchId = "f65cc408-ac13-4530-a54f-b628a53dc64a";
		const segments = [
			{
				endMs: 1_000,
				speaker: "1",
				startMs: 0,
				text: "Keep this meeting segment",
			},
		];
		const firstWorker = await loadWorker();
		await firstWorker.request({
			channels: 1,
			createdAt: 0,
			id,
			recordingType: "meeting",
			sampleRate: 16_000,
			type: "start",
		});
		firstWorker.send({
			bytes: new Int16Array(16_000).buffer,
			id,
			type: "append-pcm",
		});
		await firstWorker.request({ id, type: "flush" });
		await firstWorker.request({
			id,
			recordingType: "meeting",
			segments,
			text: "Recovered meeting transcript",
			type: "set-metadata",
		});
		await firstWorker.request({
			channels: 1,
			createdAt: 0,
			id: translationScratchId,
			recordingType: "translation",
			sampleRate: 16_000,
			type: "start",
		});
		firstWorker.send({
			bytes: new Int16Array(16_000).buffer,
			id: translationScratchId,
			type: "append-pcm",
		});
		await firstWorker.request({ id: translationScratchId, type: "flush" });
		await firstWorker.request({
			id: translationScratchId,
			recordingType: "translation",
			text: "Recovered translation",
			type: "set-metadata",
		});
		const restartedWorker = await loadWorker();
		const recovered = await restartedWorker.request({ type: "recover" });
		expect(recovered).toEqual([
			expect.objectContaining({
				durationSeconds: 1,
				id,
				segments,
				text: "Recovered meeting transcript",
				type: "meeting",
			}),
			expect.objectContaining({
				durationSeconds: 1,
				id: translationScratchId,
				text: "Recovered translation",
				type: "translation",
			}),
		]);
	} finally {
		Object.defineProperty(globalThis, "addEventListener", {
			configurable: true,
			value: originalAddEventListener,
		});
		Object.defineProperty(globalThis, "postMessage", {
			configurable: true,
			value: originalPostMessage,
		});
		if (storageDescriptor)
			Object.defineProperty(navigator, "storage", storageDescriptor);
		else Reflect.deleteProperty(navigator, "storage");
	}
});
