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
	copyRecordingText,
	displayRecordingText,
	resolveTranscriptHistory,
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
export { DEFAULT_SETTINGS, updateSettings } from "./settings";
export { SessionMachine } from "./session-machine";
export { speechPreCheck } from "./speech-precheck";

import type { Platform } from "./ports";

export interface DidunyCore {
	readonly platform: Platform;
	readonly state: CoreState;
}

export function createDiduny(platform: Platform): DidunyCore {
	return { platform, state: "idle" };
}
