import { expect, test } from "bun:test";
import {
	detectBrowserCapabilities,
	missingBrowserCapabilities,
} from "./capabilities";

const supportedBrowser = {
	AudioWorkletNode: function AudioWorkletNode() {},
	documentPictureInPicture: { requestWindow() {} },
	FileSystemFileHandle: function FileSystemFileHandle() {},
	SpeechRecognition: function SpeechRecognition() {},
	navigator: {
		mediaDevices: { getDisplayMedia() {} },
		storage: { getDirectory() {} },
	},
};

supportedBrowser.FileSystemFileHandle.prototype.createSyncAccessHandle =
	function createSyncAccessHandle() {};

test("passes a capable Chromium-like browser without inspecting its brand", () => {
	const capabilities = detectBrowserCapabilities(supportedBrowser);

	expect(capabilities).toEqual({
		audioWorklet: true,
		documentPictureInPicture: true,
		displayCaptureAudio: true,
		onDeviceSpeechRecognition: true,
		opfsSyncAccess: true,
	});
	expect(missingBrowserCapabilities(capabilities)).toEqual([]);
});

test("names every missing API and never looks at a user agent", async () => {
	const capabilities = detectBrowserCapabilities({ navigator: {} });
	expect(capabilities.documentPictureInPicture).toBe(false);

	expect(missingBrowserCapabilities(capabilities)).toEqual([
		expect.objectContaining({ key: "audioWorklet" }),
		expect.objectContaining({ key: "opfsSyncAccess" }),
		expect.objectContaining({ key: "displayCaptureAudio" }),
		expect.objectContaining({ key: "onDeviceSpeechRecognition" }),
	]);
	expect(await Bun.file("web/src/capabilities.ts").text()).not.toContain(
		"userAgent",
	);
});
