export interface AudioInputDevice {
	deviceId: string;
	label: string;
}

interface DeviceLike {
	deviceId: string;
	kind: string;
	label: string;
}

export function audioInputDevices(
	devices: Iterable<DeviceLike>,
): readonly AudioInputDevice[] {
	const inputs: AudioInputDevice[] = [];
	for (const device of devices) {
		if (device.kind !== "audioinput") continue;
		inputs.push({
			deviceId: device.deviceId,
			label: device.label || `Microphone ${inputs.length + 1}`,
		});
	}
	return inputs;
}

export function resolveAudioInput(
	inputs: readonly AudioInputDevice[],
	savedDeviceId: string | null,
) {
	const savedDevice = savedDeviceId
		? inputs.find((input) => input.deviceId === savedDeviceId)
		: null;
	return {
		device: savedDevice ?? (savedDeviceId ? (inputs[0] ?? null) : null),
		savedDeviceMissing: Boolean(savedDeviceId && !savedDevice),
	};
}

export function audioCaptureConstraints(deviceId: string | null) {
	return {
		autoGainControl: true,
		...(deviceId ? { deviceId: { exact: deviceId } } : {}),
		echoCancellation: true,
		noiseSuppression: true,
	};
}

export function microphonePermissionFailure(error: unknown) {
	return error &&
		typeof error === "object" &&
		"name" in error &&
		(error as { name?: unknown }).name === "NotAllowedError"
		? "denied"
		: "failed";
}

export function savedMicrophoneUnavailable(error: unknown) {
	return (
		!!error &&
		typeof error === "object" &&
		"name" in error &&
		((error as { name?: unknown }).name === "NotFoundError" ||
			(error as { name?: unknown }).name === "OverconstrainedError")
	);
}
