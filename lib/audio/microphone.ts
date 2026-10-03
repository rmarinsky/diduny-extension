export const DEFAULT_MICROPHONE_STORAGE_KEY = "didunyDefaultMicrophoneId";
/** Set by the permission page only once getUserMedia has succeeded there. */
export const MIC_GRANTED_STORAGE_KEY = "micGranted";
export const MICROPHONE_BLOCKED_MESSAGE =
	"Diduny needs microphone access. Click record to allow it.";

/** Offscreen documents cannot prompt, so a missing grant fails as NotAllowedError. */
export function isMicrophoneBlocked(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		error.name === "NotAllowedError"
	);
}

function validDeviceId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 512;
}

export function microphoneConstraints(
	deviceId: string | null,
): true | MediaTrackConstraints {
	return deviceId ? { deviceId: { exact: deviceId } } : true;
}

export async function getDefaultMicrophoneId(): Promise<string | null> {
	const stored = await chrome.storage.local.get(DEFAULT_MICROPHONE_STORAGE_KEY);
	const value = stored[DEFAULT_MICROPHONE_STORAGE_KEY];
	return validDeviceId(value) ? value : null;
}

export async function setDefaultMicrophoneId(deviceId: string | null) {
	await chrome.storage.local.set({
		[DEFAULT_MICROPHONE_STORAGE_KEY]: validDeviceId(deviceId) ? deviceId : null,
	});
}
