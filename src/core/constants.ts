/** Values ported from `10-constants.md`; import these instead of inlining behaviour. */
export const AUDIO_FORMAT = {
	captureBufferFrames: 4096,
	channels: 1,
	hardwareInitTimeoutMs: 5000,
	sampleRate: 16000,
	wireFormat: "s16le",
} as const;

export const VAD = {
	frameSamples: 320,
	minimumPeak: 0.015,
	minimumRms: 0.0015,
	minimumVoicedDurationMs: 180,
	skipAboveBytes: 25 * 1024 * 1024,
} as const;

export const REALTIME = {
	endpointControlToken: "<end>",
	finalizeControlToken: "<fin>",
	maxReconnectAttempts: 3,
	preReadyBufferBytes: 1_000_000,
	readyWatchdogMs: 10_000,
	uiUpdatesPerSecond: 10,
} as const;

export const FINALIZE_PROFILES = {
	dictationFast: {
		controlMessageDelayMs: 120,
		quietWindowMs: 180,
		timeoutMs: 1200,
	},
	safe: {
		controlMessageDelayMs: 350,
		quietWindowMs: 350,
		timeoutMs: 5000,
	},
} as const;

export const HTTP = {
	largeBodyBytes: 10 * 1024 * 1024,
	longUploadTimeoutMs: 20 * 60 * 1000,
	logoutTimeoutMs: 10_000,
	maxJobWaitMs: 2 * 60 * 60 * 1000,
	proactiveRefreshLeadMs: 60_000,
	statusPollRetries: 3,
} as const;

export const LONG_RECORDING = {
	chunkRotationMs: 5 * 60 * 1000,
	manifestVersion: 1,
} as const;

export const INPUT_TIMING = {
	multiPressWindowMs: 350,
	pasteFocusHandoffMs: 50,
	pasteKeyHoldMs: 12,
	pushToTalkHoldFloorMs: 200,
	pushToTalkHoldStartDelayMs: 1200,
	selectionCapturePollTimeoutMs: 800,
	tapToggleCount: 2,
} as const;

export const WEB_LATENCY_TARGET_MS = 1500;
