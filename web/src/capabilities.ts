export interface BrowserCapabilities {
	audioWorklet: boolean;
	displayCaptureAudio: boolean;
	onDeviceSpeechRecognition: boolean;
	opfsSyncAccess: boolean;
}

interface BrowserEnvironment {
	AudioWorkletNode?: unknown;
	FileSystemFileHandle?: unknown;
	SpeechRecognition?: unknown;
	navigator?: {
		mediaDevices?: { getDisplayMedia?: unknown };
		storage?: { getDirectory?: unknown };
	};
	webkitSpeechRecognition?: unknown;
}

function prototypeProperty(value: unknown, property: string) {
	if (typeof value !== "function") return undefined;
	const prototype = (value as { prototype?: Record<string, unknown> })
		.prototype;
	return prototype?.[property];
}

export const capabilityRequirements = [
	{
		key: "audioWorklet",
		label: "AudioWorklet",
		reason: "it keeps microphone capture responsive while dictating.",
	},
	{
		key: "opfsSyncAccess",
		label: "OPFS synchronous access",
		reason: "it keeps in-progress audio recoverable after an interrupted tab.",
	},
	{
		key: "displayCaptureAudio",
		label: "Display-capture audio",
		reason: "it is required for meeting recording.",
	},
	{
		key: "onDeviceSpeechRecognition",
		label: "On-device speech recognition",
		reason: "it enables the local trial path without sending audio away.",
	},
] as const satisfies ReadonlyArray<{
	key: keyof BrowserCapabilities;
	label: string;
	reason: string;
}>;

export function detectBrowserCapabilities(
	environment: BrowserEnvironment = globalThis,
): BrowserCapabilities {
	return {
		audioWorklet: typeof environment.AudioWorkletNode === "function",
		displayCaptureAudio:
			typeof environment.navigator?.mediaDevices?.getDisplayMedia ===
			"function",
		onDeviceSpeechRecognition:
			typeof environment.SpeechRecognition === "function" ||
			typeof environment.webkitSpeechRecognition === "function",
		opfsSyncAccess:
			typeof environment.navigator?.storage?.getDirectory === "function" &&
			typeof prototypeProperty(
				environment.FileSystemFileHandle,
				"createSyncAccessHandle",
			) === "function",
	};
}

export function missingBrowserCapabilities(capabilities: BrowserCapabilities) {
	return capabilityRequirements.filter(
		(requirement) => !capabilities[requirement.key],
	);
}
