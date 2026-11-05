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

test("accepts a real browser main thread where createSyncAccessHandle is worker-only", () => {
	// `FileSystemFileHandle.prototype.createSyncAccessHandle` is `[Exposed=DedicatedWorker]`,
	// so it is absent on the main-thread prototype in every engine. The gate must still pass.
	const mainThread = {
		AudioWorkletNode: function AudioWorkletNode() {},
		FileSystemFileHandle: function FileSystemFileHandle() {},
		SpeechRecognition: function SpeechRecognition() {},
		navigator: {
			mediaDevices: { getDisplayMedia() {} },
			storage: { getDirectory() {} },
		},
	};

	const capabilities = detectBrowserCapabilities(mainThread);

	expect(capabilities.opfsSyncAccess).toBe(true);
	expect(missingBrowserCapabilities(capabilities)).toEqual([]);
});

test("flags OPFS when storage.getDirectory is present but FileSystemFileHandle is not", () => {
	const capabilities = detectBrowserCapabilities({
		AudioWorkletNode: function AudioWorkletNode() {},
		SpeechRecognition: function SpeechRecognition() {},
		navigator: {
			mediaDevices: { getDisplayMedia() {} },
			storage: { getDirectory() {} },
		},
	});

	expect(capabilities.opfsSyncAccess).toBe(false);
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
