export interface BrowserCapabilities {
	audioWorklet: boolean;
	documentPictureInPicture: boolean;
	displayCaptureAudio: boolean;
	onDeviceSpeechRecognition: boolean;
	opfsSyncAccess: boolean;
}

interface BrowserEnvironment {
	AudioWorkletNode?: unknown;
	documentPictureInPicture?: { requestWindow?: unknown };
	FileSystemFileHandle?: unknown;
	SpeechRecognition?: unknown;
	navigator?: {
		mediaDevices?: { getDisplayMedia?: unknown };
		storage?: { getDirectory?: unknown };
	};
	webkitSpeechRecognition?: unknown;
}

export const capabilityRequirements = [
	{
		key: "audioWorklet",
	},
	{
		key: "opfsSyncAccess",
	},
	{
		key: "displayCaptureAudio",
	},
	{
		key: "onDeviceSpeechRecognition",
	},
] as const satisfies ReadonlyArray<{ key: keyof BrowserCapabilities }>;

export function detectBrowserCapabilities(
	environment: BrowserEnvironment = globalThis,
): BrowserCapabilities {
	return {
		audioWorklet: typeof environment.AudioWorkletNode === "function",
		documentPictureInPicture:
			typeof environment.documentPictureInPicture?.requestWindow === "function",
		displayCaptureAudio:
			typeof environment.navigator?.mediaDevices?.getDisplayMedia ===
			"function",
		onDeviceSpeechRecognition:
			typeof environment.SpeechRecognition === "function" ||
			typeof environment.webkitSpeechRecognition === "function",
		// `createSyncAccessHandle` is `[Exposed=DedicatedWorker]`, so it is never on
		// the main-thread prototype. The scratch worker is the real consumer; wherever
		// a secure context exposes `getDirectory` here, sync access handles work there.
		opfsSyncAccess:
			typeof environment.navigator?.storage?.getDirectory === "function" &&
			typeof environment.FileSystemFileHandle === "function",
	};
}

export function missingBrowserCapabilities(capabilities: BrowserCapabilities) {
	return capabilityRequirements.filter(
		(requirement) => !capabilities[requirement.key],
	);
}
