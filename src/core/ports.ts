import type { Recording } from "./models";
import type { Settings } from "./settings";

export type AudioBytes = Uint8Array;
export type Unsubscribe = () => void;

export interface AudioDevice {
	id: string;
	label: string;
}

export interface AudioRecorderPort {
	readonly isAvailable: boolean;
	cancel(): void;
	onLevel(callback: (level: number) => void): Unsubscribe;
	onPcmFrame(callback: (frame: Uint8Array) => void): Unsubscribe;
	start(device: AudioDevice | null): Promise<void>;
	stop(): Promise<AudioBytes>;
}

export interface AudioDevicePort {
	readonly isAvailable: boolean;
	getDefault(): Promise<AudioDevice | null>;
	list(): Promise<readonly AudioDevice[]>;
	resolve(
		preferredId: string | null,
	): Promise<{ device: AudioDevice | null; didFallback: boolean }>;
}

export interface SystemAudioPort {
	readonly isAvailable: boolean;
	cancel(): Promise<void>;
	start(): Promise<void>;
	stop(): Promise<AudioBytes | null>;
}

export interface ClipboardPort {
	readonly canPaste: boolean;
	readonly isAvailable: boolean;
	copy(text: string): Promise<void>;
	paste(): Promise<void>;
}

export interface HotkeyPort {
	readonly isAvailable: boolean;
	register(action: string, shortcut: string): Promise<void>;
	unregisterAll(): Promise<void>;
}

export interface KeyEventPort {
	readonly isAvailable: boolean;
	start(): Promise<void>;
	stop(): Promise<void>;
}

// No transaction concept: durable library ownership belongs to the BFF.
export interface BlobStorePort {
	readonly isAvailable: boolean;
	delete(ids: readonly string[]): Promise<void>;
	read(id: string): Promise<AudioBytes>;
	write(id: string, bytes: AudioBytes): Promise<void>;
}

export interface MetadataStorePort {
	readonly isAvailable: boolean;
	deleteRecordings(ids: readonly string[]): Promise<void>;
	loadAll(): Promise<readonly Recording[]>;
	upsertRecording(recording: Recording): Promise<void>;
}

export interface SettingsPort {
	readonly isAvailable: boolean;
	get(): Settings;
	set(settings: Settings): Promise<void>;
}

export interface SecretsPort {
	readonly isAvailable: boolean;
	delete(key: string): Promise<void>;
	read(key: string): Promise<string | null>;
	save(key: string, value: string): Promise<void>;
}

export interface LocalInferencePort {
	readonly isAvailable: boolean;
	transcribe(pcm: Float32Array): Promise<string>;
}

export interface RemoteMediaPort {
	readonly canAcquire: boolean;
	readonly isAvailable: boolean;
	acquire(url: string): Promise<AudioBytes>;
}

export interface UpdaterPort {
	readonly isAvailable: boolean;
	checkNow(): Promise<void>;
}

export interface PermissionPort {
	readonly isAvailable: boolean;
	request(
		permission: "displayCapture" | "microphone",
	): Promise<"denied" | "granted" | "prompt">;
	status(
		permission: "displayCapture" | "microphone",
	): Promise<"denied" | "granted" | "prompt">;
}

export interface PowerPort {
	readonly isAvailable: boolean;
	preventSleep(): { dispose(): void };
}

export interface HttpRequest {
	body?: Uint8Array | string;
	headers?: Readonly<Record<string, string>>;
	method: string;
	path: string;
}

export interface HttpResponse {
	body: Uint8Array;
	headers: Readonly<Record<string, string>>;
	status: number;
}

export interface HttpPort {
	readonly isAvailable: boolean;
	send(request: HttpRequest): Promise<HttpResponse>;
}

export interface ClockPort {
	now(): number;
}

export interface LoggerPort {
	error(event: string, fields?: Readonly<Record<string, unknown>>): void;
	info(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface Platform {
	audio: AudioRecorderPort;
	blobs: BlobStorePort;
	clock: ClockPort;
	clipboard: ClipboardPort;
	devices: AudioDevicePort;
	hotkeys: HotkeyPort;
	http: HttpPort;
	inference: LocalInferencePort;
	keyEvents: KeyEventPort;
	logger: LoggerPort;
	metadata: MetadataStorePort;
	permissions: PermissionPort;
	power: PowerPort;
	remoteMedia: RemoteMediaPort;
	secrets: SecretsPort;
	settings: SettingsPort;
	systemAudio: SystemAudioPort;
	updater: UpdaterPort;
}
