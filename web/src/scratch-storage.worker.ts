import { LONG_RECORDING } from "../../src/core/constants";
import { wavHeader } from "./wav";

interface SyncAccessHandle {
	close(): void | Promise<void>;
	flush(): void | Promise<void>;
	truncate(size: number): void;
	write(data: Uint8Array, options?: { at?: number }): number;
}

interface ScratchFileHandle {
	createSyncAccessHandle(): Promise<SyncAccessHandle>;
	getFile(): Promise<File>;
}

interface ScratchDirectoryHandle {
	entries(): AsyncIterableIterator<[string, { kind: string }]>;
	getDirectoryHandle(
		name: string,
		options?: { create?: boolean },
	): Promise<ScratchDirectoryHandle>;
	getFileHandle(
		name: string,
		options?: { create?: boolean },
	): Promise<ScratchFileHandle>;
	removeEntry(name: string): Promise<void>;
}

interface ScratchManifest {
	channels: number;
	createdAt: number;
	id: string;
	sampleRate: number;
	text: string;
	version: number;
}

interface OpenCapture {
	encoded: { bytes: number; failed: boolean; handle: SyncAccessHandle };
	manifest: ScratchManifest;
	manifestHandle: SyncAccessHandle;
	pcm: { bytes: number; failed: boolean; handle: SyncAccessHandle };
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

const scope = globalThis as unknown as {
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<WorkerCommand>) => void,
	): void;
	postMessage(message: unknown): void;
};
const captures = new Map<string, OpenCapture>();
const encoder = new TextEncoder();
const scratchDirectoryName = "diduny-scratch";

function validId(value: string) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		value,
	);
}

function manifestName(id: string) {
	return `${id}.json`;
}

function pcmName(id: string) {
	return `${id}.pcm`;
}

function encodedName(id: string) {
	return `${id}.webm`;
}

async function directory(): Promise<ScratchDirectoryHandle> {
	const storage = navigator.storage as StorageManager & {
		getDirectory?: () => Promise<FileSystemDirectoryHandle>;
	};
	if (!storage.getDirectory) throw new Error("OPFS is unavailable");
	const root = await storage.getDirectory();
	return root.getDirectoryHandle(scratchDirectoryName, {
		create: true,
	}) as unknown as ScratchDirectoryHandle;
}

function writeAll(handle: SyncAccessHandle, data: Uint8Array, at = 0) {
	let offset = 0;
	while (offset < data.byteLength) {
		const written = handle.write(data.subarray(offset), { at: at + offset });
		if (!written) throw new Error("Could not write scratch audio");
		offset += written;
	}
}

function writeManifest(capture: OpenCapture) {
	const data = encoder.encode(JSON.stringify(capture.manifest));
	writeAll(capture.manifestHandle, data);
	capture.manifestHandle.truncate(data.byteLength);
}

function append(
	target:
		| { bytes: number; failed: boolean; handle: SyncAccessHandle }
		| undefined,
	data: ArrayBuffer,
) {
	if (!target || target.failed) return;
	try {
		const bytes = new Uint8Array(data);
		writeAll(target.handle, bytes, target.bytes);
		target.bytes += bytes.byteLength;
	} catch {
		target.failed = true;
	}
}

async function closeCapture(capture: OpenCapture) {
	for (const handle of [
		capture.pcm.handle,
		capture.encoded.handle,
		capture.manifestHandle,
	]) {
		try {
			await handle.flush();
		} catch {
			// The byte count below still determines whether the other format can recover.
		}
		await handle.close();
	}
}

async function removeCapture(
	directoryHandle: ScratchDirectoryHandle,
	id: string,
) {
	for (const name of [manifestName(id), pcmName(id), encodedName(id)])
		await directoryHandle.removeEntry(name).catch(() => undefined);
}

function validManifest(value: unknown): value is ScratchManifest {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === LONG_RECORDING.manifestVersion &&
		typeof record.id === "string" &&
		validId(record.id) &&
		typeof record.createdAt === "number" &&
		Number.isFinite(record.createdAt) &&
		typeof record.sampleRate === "number" &&
		Number.isFinite(record.sampleRate) &&
		record.sampleRate > 0 &&
		typeof record.channels === "number" &&
		Number.isFinite(record.channels) &&
		record.channels > 0 &&
		typeof record.text === "string"
	);
}

function toRecoveredRecording(manifest: ScratchManifest, pcm: File) {
	const durationSeconds =
		pcm.size / (manifest.sampleRate * manifest.channels * 2);
	return {
		audio: new Blob([wavHeader(pcm.size), pcm], { type: "audio/wav" }),
		durationSeconds,
		id: manifest.id,
		text: manifest.text,
	};
}

async function start(command: Extract<WorkerCommand, { type: "start" }>) {
	if (!validId(command.id)) throw new Error("Invalid scratch recording id");
	const directoryHandle = await directory();
	const manifest: ScratchManifest = {
		channels: command.channels,
		createdAt: command.createdAt,
		id: command.id,
		sampleRate: command.sampleRate,
		text: "",
		version: LONG_RECORDING.manifestVersion,
	};
	const [manifestFile, pcmFile, encodedFile] = await Promise.all([
		directoryHandle.getFileHandle(manifestName(command.id), { create: true }),
		directoryHandle.getFileHandle(pcmName(command.id), { create: true }),
		directoryHandle.getFileHandle(encodedName(command.id), { create: true }),
	]);
	const [manifestHandle, pcmHandle, encodedHandle] = await Promise.all([
		manifestFile.createSyncAccessHandle(),
		pcmFile.createSyncAccessHandle(),
		encodedFile.createSyncAccessHandle(),
	]);
	const capture: OpenCapture = {
		encoded: { bytes: 0, failed: false, handle: encodedHandle },
		manifest,
		manifestHandle,
		pcm: { bytes: 0, failed: false, handle: pcmHandle },
	};
	writeManifest(capture);
	await manifestHandle.flush();
	captures.set(command.id, capture);
}

async function complete(id: string) {
	const capture = captures.get(id);
	if (!capture) throw new Error("Scratch recording is not open");
	captures.delete(id);
	await closeCapture(capture);
	const directoryHandle = await directory();
	const pcm = await (
		await directoryHandle.getFileHandle(pcmName(id))
	).getFile();
	if (!capture.encoded.failed && capture.encoded.bytes > 0) {
		const encoded = await (
			await directoryHandle.getFileHandle(encodedName(id))
		).getFile();
		return {
			audio: new Blob([encoded], { type: "audio/webm;codecs=opus" }),
			durationSeconds:
				pcm.size > 0
					? pcm.size /
						(capture.manifest.sampleRate * capture.manifest.channels * 2)
					: Math.max(0, (Date.now() - capture.manifest.createdAt) / 1000),
			id,
			text: capture.manifest.text,
		};
	}
	if (!pcm.size) throw new Error("Scratch recording has no audio");
	return toRecoveredRecording(capture.manifest, pcm);
}

async function recover() {
	const directoryHandle = await directory();
	const recovered: ReturnType<typeof toRecoveredRecording>[] = [];
	for await (const [name, handle] of directoryHandle.entries()) {
		if (!name.endsWith(".json") || handle.kind !== "file") continue;
		let manifest: ScratchManifest | null = null;
		try {
			const file = await (handle as unknown as ScratchFileHandle).getFile();
			const value: unknown = JSON.parse(await file.text());
			if (validManifest(value)) manifest = value;
		} catch {
			continue;
		}
		if (!manifest) continue;
		try {
			const pcm = await (
				await directoryHandle.getFileHandle(pcmName(manifest.id))
			).getFile();
			if (!pcm.size) {
				await removeCapture(directoryHandle, manifest.id);
				continue;
			}
			recovered.push(toRecoveredRecording(manifest, pcm));
		} catch {
			await removeCapture(directoryHandle, manifest.id);
		}
	}
	return recovered.sort((left, right) => left.id.localeCompare(right.id));
}

async function handle(command: WorkerCommand) {
	switch (command.type) {
		case "append-pcm":
			append(captures.get(command.id)?.pcm, command.bytes);
			return undefined;
		case "append-encoded":
			append(captures.get(command.id)?.encoded, command.bytes);
			return undefined;
		case "set-text": {
			const capture = captures.get(command.id);
			if (!capture) return undefined;
			capture.manifest.text = command.text;
			try {
				writeManifest(capture);
			} catch {
				// Audio remains recoverable even if an interim transcript cannot be persisted.
			}
			return undefined;
		}
		case "flush": {
			const capture = captures.get(command.id);
			if (capture) {
				for (const handle of [
					capture.pcm.handle,
					capture.encoded.handle,
					capture.manifestHandle,
				])
					await handle.flush();
			}
			return undefined;
		}
		case "discard": {
			const capture = captures.get(command.id);
			if (capture) {
				captures.delete(command.id);
				await closeCapture(capture);
			}
			await removeCapture(await directory(), command.id);
			return undefined;
		}
		case "complete":
			return complete(command.id);
		case "recover":
			return recover();
		case "start":
			return start(command);
	}
}

scope.addEventListener("message", (event) => {
	const command = event.data;
	if (!command || typeof command !== "object") return;
	void handle(command)
		.then((value) => {
			if ("requestId" in command)
				scope.postMessage({
					requestId: command.requestId,
					type: "result",
					value,
				});
		})
		.catch((error) => {
			if ("requestId" in command)
				scope.postMessage({
					message:
						error instanceof Error ? error.message : "Scratch storage failed",
					requestId: command.requestId,
					type: "error",
				});
		});
});
