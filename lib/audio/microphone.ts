export const DEFAULT_MICROPHONE_STORAGE_KEY = "didunyDefaultMicrophoneId";

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
