import { expect, test } from "bun:test";
import { isMicrophoneBlocked, microphoneConstraints } from "./microphone";

test("uses the selected microphone exactly and otherwise leaves device choice to Chromium", () => {
	expect(microphoneConstraints(null)).toBe(true);
	expect(microphoneConstraints("usb-mic")).toEqual({
		deviceId: { exact: "usb-mic" },
	});
});

test("recognises a missing microphone grant but not other capture failures", () => {
	expect(
		isMicrophoneBlocked(
			new DOMException("Permission dismissed", "NotAllowedError"),
		),
	).toBe(true);
	expect(
		isMicrophoneBlocked(
			new DOMException("Requested device not found", "NotFoundError"),
		),
	).toBe(false);
	expect(isMicrophoneBlocked(new Error("Permission dismissed"))).toBe(false);
	expect(isMicrophoneBlocked(null)).toBe(false);
});
