export type CoreState = "idle";

export function createCore(): { state: CoreState } {
	return { state: "idle" };
}

export {
	AUDIO_FORMAT,
	FINALIZE_PROFILES,
	REALTIME,
	TIME,
	VAD,
} from "./constants";
export { createFakePlatform } from "./fake-platform";
export {
	cleanDictationText,
	copyRecordingText,
	displayRecordingText,
	resolveTranscriptHistory,
	timeSavedSeconds,
	timeSavedSecondsForWords,
	wordCount,
} from "./models";
export type { Platform } from "./ports";
export {
	AuthenticationError,
	DecodeError,
	MemoryTokenStore,
	ProxyApiClient,
	ProxyApiError,
	UsageLimitError,
	decodeTranscriptResult,
} from "./proxy-api-client";
export {
	DidunyError,
	isDidunyError,
	remoteAcquisitionUnavailableOnWeb,
	type DidunyErrorCode,
	type DidunyErrorDetails,
} from "./errors";
export {
	DEFAULT_SETTINGS,
	DEFAULT_TYPING_SPEED_WPM,
	effectiveTypingSpeed,
	normalizeSettings,
	textCleanupFromSettings,
	updateSettings,
} from "./settings";
export {
	DEFAULT_DICTATION_SHORTCUT,
	firesInTextFields,
	isReservedShortcut,
	matchesShortcut,
	normalizeShortcut,
	shortcutKeyFromEvent,
} from "./shortcuts";
export {
	isValidEmail,
	isValidOtp,
	normalizeEmail,
	normalizeOtp,
} from "./auth-validation";
export {
	RealtimeSession,
	RealtimeSessionError,
	type RealtimeErrorCode,
	type RealtimeScheduler,
	type RealtimeSocket,
	type RealtimeSocketHandlers,
	type RealtimeToken,
} from "./realtime-session";
export { SessionMachine } from "./session-machine";
export {
	createSpeechPreCheckAccumulator,
	speechPreCheck,
} from "./speech-precheck";
export {
	buildTranscriptionConfig,
	type TranscriptionTranslation,
} from "./transcription-config";

import type { Platform } from "./ports";

export interface DidunyCore {
	readonly platform: Platform;
	readonly state: CoreState;
}

export function createDiduny(platform: Platform): DidunyCore {
	return { platform, state: "idle" };
}
