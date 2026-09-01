import { expect, test } from "bun:test";
import { microphoneConstraints } from "./microphone";

test("uses the selected microphone exactly and otherwise leaves device choice to Chromium", () => {
	expect(microphoneConstraints(null)).toBe(true);
	expect(microphoneConstraints("usb-mic")).toEqual({
		deviceId: { exact: "usb-mic" },
	});
});
