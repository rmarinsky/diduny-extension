import type {
	RecordingMode,
	RecordingState,
	TranscriptionToken,
} from "../types";

export type AudioSource = "mic" | "tab";

// Side panel → Background
export type StartRecording = {
	type: "start-recording";
	mode: RecordingMode;
	language: string;
	diarization: boolean;
	targetTabId?: number;
	streamId?: string;
	canRequestAudioTrack?: boolean;
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

// Background → Offscreen
export type StartCapture = {
	type: "start-capture";
	mode: RecordingMode;
	accessToken: string;
	language: string;
	diarization: boolean;
	streamId?: string;
	canRequestAudioTrack?: boolean;
};
export type StopCapture = { type: "stop-capture" };

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
export type CaptureError = {
	type: "capture-error";
	error: string;
};

export type Message =
	| StartRecording
	| StopRecording
	| RecordingStateChanged
	| RealtimeTokens
	| TranscriptionComplete
	| StartCapture
	| StopCapture
	| CaptureTokens
	| CaptureComplete
	| CaptureError;
