import type {
	RecordingMode,
	RecordingState,
	TranscriptionToken,
} from "../types";

export type AudioSource = "mic" | "tab";

// ── Auth messages (per ADR-0005) ──────────────────────────────────────────────

/** Side panel → Background: initiate OTP login */
export type SignInRequest = {
	type: "signInRequest";
	email: string;
};

/** Side panel → Background: verify the OTP code */
export type VerifyOtpRequest = {
	type: "verifyOtpRequest";
	email: string;
	token: string;
};

/** Side panel → Background: sign out current user */
export type SignOutRequest = { type: "signOutRequest" };

/**
 * Offscreen → Background: obtain current access token.
 * Per ADR-0005: SW responds async (return true) with TokenResult.
 * Response is handled via the sendMessage callback, not via this union.
 */
export type GetAccessToken = { type: "getAccessToken" };

// ── Recording messages ────────────────────────────────────────────────────────

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
export type CaptureError = {
	type: "capture-error";
	error: string;
};

export type Message =
	// Auth
	| SignInRequest
	| VerifyOtpRequest
	| SignOutRequest
	| GetAccessToken
	// Recording
	| StartRecording
	| StopRecording
	| RecordingStateChanged
	| RealtimeTokens
	| TranscriptionComplete
	| StartCapture
	| StopCapture
	| ForceClose
	| CaptureTokens
	| CaptureComplete
	| CaptureError;
