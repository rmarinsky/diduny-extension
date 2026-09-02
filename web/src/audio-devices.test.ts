import { expect, test } from "bun:test";
import {
	audioCaptureConstraints,
	audioInputDevices,
	microphonePermissionFailure,
	resolveAudioInput,
	savedMicrophoneUnavailable,
} from "./audio-devices";

test("selects a persisted microphone and names a real fallback when it disappears", () => {
	const inputs = audioInputDevices([
		{ deviceId: "", kind: "audiooutput", label: "Speaker" },
		{ deviceId: "built-in", kind: "audioinput", label: "Built-in Microphone" },
		{ deviceId: "usb", kind: "audioinput", label: "USB Microphone" },
	]);

	expect(resolveAudioInput(inputs, "usb")).toEqual({
		device: { deviceId: "usb", label: "USB Microphone" },
		savedDeviceMissing: false,
	});
	expect(resolveAudioInput(inputs, "missing")).toEqual({
		device: { deviceId: "built-in", label: "Built-in Microphone" },
		savedDeviceMissing: true,
	});
	expect(resolveAudioInput(inputs, null)).toEqual({
		device: null,
		savedDeviceMissing: false,
	});
});

test("classifies browser microphone denial without treating ordinary errors as denial", () => {
	expect(microphonePermissionFailure({ name: "NotAllowedError" })).toBe(
		"denied",
	);
	expect(microphonePermissionFailure({ name: "AbortError" })).toBe("failed");
	expect(savedMicrophoneUnavailable({ name: "NotFoundError" })).toBe(true);
	expect(savedMicrophoneUnavailable({ name: "NotReadableError" })).toBe(false);
});

test("uses the saved device with dictation-friendly browser audio processing", () => {
	expect(audioCaptureConstraints("usb")).toEqual({
		autoGainControl: true,
		deviceId: { exact: "usb" },
		echoCancellation: true,
		noiseSuppression: true,
	});
	expect(audioCaptureConstraints(null)).not.toHaveProperty("deviceId");
});
