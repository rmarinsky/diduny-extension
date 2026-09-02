import type {
	RecordingMode,
	RecordingState,
	TranscriptionToken,
} from "../types";

export type AudioSource = "mic" | "tab";
export type DictationTranslation = { targetLanguage: string };

// ── Recording messages ────────────────────────────────────────────────────────

// Side panel → Background
export type StartRecording = {
	type: "start-recording";
	mode: RecordingMode;
	language: string;
	diarization: boolean;
	targetTabId?: number;
	streamId?: string;
	translation?: DictationTranslation;
};
export type StopRecording = { type: "stop-recording" };

// Background → Side panel
export type RecordingStateChanged = {
	type: "recording-state-changed";
	state: RecordingState;
	error?: string;
};
export type RealtimeTokens = {
	type: "realtime-tokens";
	tokens: TranscriptionToken[];
	source: AudioSource;
};
export type TranscriptionComplete = {
	type: "transcription-complete";
	text: string;
	source: AudioSource;
};
export type DeliveryAvailability = {
	type: "delivery-availability";
	available: boolean;
	reason?:
		| "no-text-field"
		| "permission-denied"
		| "site-disabled"
		| "target-unavailable"
		| "unsupported-editor";
};

// Background → Offscreen
export type StartCapture = {
	type: "start-capture";
	mode: RecordingMode;
	bffOrigin: string;
	language: string;
	diarization: boolean;
	microphoneDeviceId?: string | null;
	streamId?: string;
	translation?: DictationTranslation;
};
export type StopCapture = { type: "stop-capture" };

// Offscreen → Background
export type CaptureReady = { type: "capture-ready" };

// Background → Offscreen: force-close on logout (per ADR-0005 logout flow)
export type ForceClose = { type: "forceClose" };

// Offscreen → Background
export type CaptureTokens = {
	type: "capture-tokens";
	tokens: TranscriptionToken[];
	source: AudioSource;
};
export type CaptureComplete = {
	type: "capture-complete";
	text: string;
	source: AudioSource;
};
export type CapturePersisted = {
	type: "capture-persisted";
	source: AudioSource;
};
export type CaptureError = {
	type: "capture-error";
	error: string;
};

export type Message =
	// Recording
	| StartRecording
	| StopRecording
	| RecordingStateChanged
	| RealtimeTokens
	| TranscriptionComplete
	| DeliveryAvailability
	| StartCapture
	| StopCapture
	| CaptureReady
	| ForceClose
	| CaptureTokens
	| CaptureComplete
	| CapturePersisted
	| CaptureError;
