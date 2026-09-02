import type {
	ProcessingStatus,
	Recording,
	RecordingType,
	TranscriptSegment,
	TranscriptVersion,
} from "./models";
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

export type RetentionCategory = "dictation" | "meeting";
export type RetentionPolicy =
	| "days7"
	| "days30"
	| "days90"
	| "forever"
	| "never"
	| "year1";

export interface LibraryAudio {
	bytes: Uint8Array;
	contentType: string;
}

export interface NewLibraryRecording {
	createdAt?: number;
	description?: string;
	durationSeconds: number;
	provider?: string;
	segments?: readonly TranscriptSegment[];
	status: ProcessingStatus;
	text: string;
	title?: string;
	type: RecordingType;
}

export interface LibraryMedia {
	contentType: string;
	fileName: string;
	fileSizeBytes: number;
	id: string;
}

export interface LibraryMetadata {
	description?: string | null;
	title?: string | null;
}

export interface LibraryDetail extends Recording {
	description?: string;
	displayText: string;
	durationSeconds: number;
	history: readonly TranscriptVersion[];
	media: LibraryMedia;
}

export interface RecordingSummary {
	createdAt: number;
	displayTitle: string;
	durationSeconds: number;
	hasTranslation: boolean;
	id: string;
	snippet?: string;
	status: ProcessingStatus;
	type: RecordingType;
}

export interface LibraryListOptions {
	limit?: number;
	offset?: number;
	search?: string;
	status?: readonly ProcessingStatus[];
	type?: readonly RecordingType[];
}

export interface LibraryPage {
	items: readonly RecordingSummary[];
	nextOffset?: number;
}

export interface LibraryMaintenance {
	reconcile(): Promise<{ removedOrphans: number }>;
	sweepRetention(): Promise<{ removed: number }>;
}

export interface BatchLibraryPort {
	remove(id: string): Promise<{ removedRecordings: readonly string[] }>;
}

// One server-side owner holds the database/filesystem transaction. The core has no blob transaction.
export interface LibraryPort {
	readonly batches: BatchLibraryPort;
	readonly isAvailable: boolean;
	readonly maintenance: LibraryMaintenance;
	getRetentionPolicies(): Promise<Record<RetentionCategory, RetentionPolicy>>;
	list(options?: LibraryListOptions): Promise<LibraryPage>;
	open(id: string): Promise<LibraryDetail | null>;
	remove(ids: readonly string[]): Promise<void>;
	save(
		recording: NewLibraryRecording,
		audio: LibraryAudio,
	): Promise<LibraryDetail | null>;
	setRetentionPolicy(
		category: RetentionCategory,
		policy: RetentionPolicy,
	): Promise<void>;
	updateMetadata(
		id: string,
		metadata: LibraryMetadata,
	): Promise<LibraryDetail | null>;
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
	clock: ClockPort;
	clipboard: ClipboardPort;
	devices: AudioDevicePort;
	hotkeys: HotkeyPort;
	http: HttpPort;
	inference: LocalInferencePort;
	keyEvents: KeyEventPort;
	library: LibraryPort;
	logger: LoggerPort;
	permissions: PermissionPort;
	power: PowerPort;
	remoteMedia: RemoteMediaPort;
	secrets: SecretsPort;
	settings: SettingsPort;
	systemAudio: SystemAudioPort;
	updater: UpdaterPort;
}
