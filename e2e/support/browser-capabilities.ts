import type { BrowserContext } from "@playwright/test";

export async function installSupportedBrowserCapabilities(
	context: BrowserContext,
) {
	await context.addInitScript(() => {
		const browser = globalThis as typeof globalThis & {
			FileSystemFileHandle?: { prototype: Record<string, unknown> };
			SpeechRecognition?: unknown;
		};
		const browserNavigator = navigator as Navigator & {
			storage?: { getDirectory?: unknown };
		};
		if (typeof browser.AudioWorkletNode !== "function") {
			Object.defineProperty(browser, "AudioWorkletNode", {
				configurable: true,
				value: function AudioWorkletNode() {},
			});
		}
		if (!browser.FileSystemFileHandle) {
			Object.defineProperty(browser, "FileSystemFileHandle", {
				configurable: true,
				value: function FileSystemFileHandle() {},
			});
		}
		if (
			browser.FileSystemFileHandle &&
			typeof browser.FileSystemFileHandle.prototype.createSyncAccessHandle !==
				"function"
		) {
			Object.defineProperty(
				browser.FileSystemFileHandle.prototype,
				"createSyncAccessHandle",
				{ configurable: true, value: () => undefined },
			);
		}
		if (!browserNavigator.storage) {
			Object.defineProperty(browserNavigator, "storage", {
				configurable: true,
				value: { getDirectory: () => undefined },
			});
		} else if (typeof browserNavigator.storage.getDirectory !== "function") {
			Object.defineProperty(browserNavigator.storage, "getDirectory", {
				configurable: true,
				value: () => undefined,
			});
		}
		if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
			Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
				configurable: true,
				value: () => Promise.reject(new Error("test display capture")),
			});
		}
		if (typeof browser.SpeechRecognition !== "function") {
			Object.defineProperty(browser, "SpeechRecognition", {
				configurable: true,
				value: function SpeechRecognition() {},
			});
		}
	});
}
