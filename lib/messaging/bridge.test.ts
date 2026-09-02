import { afterEach, expect, test } from "bun:test";
import { onMessage, sendMessageUntilAcknowledged } from "./bridge";

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");

afterEach(() => {
	if (originalChrome)
		Object.defineProperty(globalThis, "chrome", originalChrome);
	else Reflect.deleteProperty(globalThis, "chrome");
});

test("retries an interrupted-start error until the background acknowledges it", async () => {
	let attempts = 0;
	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		value: {
			runtime: {
				async sendMessage() {
					attempts += 1;
					if (attempts === 1) throw new Error("worker stopped before ACK");
					return attempts === 3 ? { acknowledged: true } : undefined;
				},
			},
		},
	});

	await sendMessageUntilAcknowledged(
		{ error: "Could not start microphone capture", type: "capture-error" },
		0,
	);
	expect(attempts).toBe(3);
});

test("acknowledges an async message only after its handler finishes", async () => {
	let listener!: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		value: {
			runtime: {
				onMessage: {
					addListener(value: typeof listener) {
						listener = value;
					},
					removeListener() {},
				},
			},
		},
	});
	onMessage(async () => true);

	const response = new Promise((resolve) =>
		listener({ type: "capture-persisted" }, {}, resolve),
	);
	expect(await response).toEqual({ acknowledged: true });
});
