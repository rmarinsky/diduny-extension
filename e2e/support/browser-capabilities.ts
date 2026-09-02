import type { BrowserContext } from "@playwright/test";

export async function installSupportedBrowserCapabilities(
	context: BrowserContext,
	{ onboardingCompleted = true }: { onboardingCompleted?: boolean } = {},
) {
	await context.addInitScript((completeOnboarding) => {
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
		if (completeOnboarding)
			localStorage.setItem("diduny.onboarding.completed", "1");
	}, onboardingCompleted);
}

export async function installFakeMicrophones(context: BrowserContext) {
	await context.addInitScript(() => {
		let permission: "denied" | "granted" | "prompt" = "prompt";
		Object.defineProperty(globalThis, "setDidunyMicrophonePermission", {
			configurable: true,
			value(next: "denied" | "granted" | "prompt") {
				permission = next;
			},
		});
		Object.defineProperty(navigator, "permissions", {
			configurable: true,
			value: {
				query: async () => ({ state: permission }),
			},
		});
		Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
			configurable: true,
			value: async () =>
				permission === "granted"
					? [
							{
								deviceId: "built-in",
								kind: "audioinput",
								label: "Built-in Microphone",
							},
							{
								deviceId: "usb",
								kind: "audioinput",
								label: "USB Microphone",
							},
						]
					: [],
		});
		Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
			configurable: true,
			value: async () => {
				if (permission === "denied")
					throw new DOMException("Microphone denied", "NotAllowedError");
				permission = "granted";
				return new MediaStream();
			},
		});
	});
}

export async function installFakeDictationCapture(context: BrowserContext) {
	await context.addInitScript(() => {
		class FakeAudioContext {
			audioWorklet = { addModule: async () => undefined };

			createMediaStreamDestination() {
				return { stream: new MediaStream() };
			}

			createMediaStreamSource() {
				return { connect() {} };
			}

			close() {
				return Promise.resolve();
			}

			resume() {
				return Promise.resolve();
			}
		}

		class FakeAudioWorkletNode {
			port: {
				onmessage: ((event: { data: unknown }) => void) | null;
			} = { onmessage: null };
			private readonly timer: number;

			constructor() {
				this.timer = window.setInterval(() => {
					const frame = new Int16Array(1_600).fill(1638);
					this.port.onmessage?.({
						data: { frame: frame.buffer, level: 0.4 },
					});
				}, 100);
			}

			connect() {}

			disconnect() {
				window.clearInterval(this.timer);
			}
		}

		class FakeMediaRecorder {
			static isTypeSupported() {
				return true;
			}

			mimeType = "audio/webm;codecs=opus";
			state: RecordingState = "inactive";
			private listeners = new Map<string, Array<(event: Event) => void>>();

			addEventListener(type: string, callback: (event: Event) => void) {
				const callbacks = this.listeners.get(type) ?? [];
				callbacks.push(callback);
				this.listeners.set(type, callbacks);
			}

			start() {
				this.state = "recording";
			}

			stop() {
				this.state = "inactive";
				this.emit("dataavailable", {
					data: new Blob(["fake-audio"], { type: this.mimeType }),
				} as unknown as Event);
				this.emit("stop", new Event("stop"));
			}

			private emit(type: string, event: Event) {
				for (const callback of this.listeners.get(type) ?? []) callback(event);
			}
		}

		Object.defineProperty(globalThis, "AudioContext", {
			configurable: true,
			value: FakeAudioContext,
		});
		Object.defineProperty(globalThis, "AudioWorkletNode", {
			configurable: true,
			value: FakeAudioWorkletNode,
		});
		Object.defineProperty(globalThis, "MediaRecorder", {
			configurable: true,
			value: FakeMediaRecorder,
		});
		Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
			configurable: true,
			value: async () => new MediaStream(),
		});
	});
}
