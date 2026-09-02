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

test("terminal sender waits for durable handler work before accepting its ACK", async () => {
	let listener!: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
	let finishHandler!: (handled: boolean) => void;
	let markHandlerStarted!: () => void;
	let responseSent = false;
	let deliveryFinished = false;
	const handlerStarted = new Promise<void>((resolve) => {
		markHandlerStarted = resolve;
	});
	const handlerFinished = new Promise<boolean>((resolve) => {
		finishHandler = resolve;
	});
	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		value: {
			runtime: {
				sendMessage(message: unknown) {
					return new Promise((resolve) => {
						listener(message, {}, (response) => {
							responseSent = true;
							resolve(response);
						});
					});
				},
				onMessage: {
					addListener(value: typeof listener) {
						listener = value;
					},
					removeListener() {},
				},
			},
		},
	});
	onMessage(async () => {
		markHandlerStarted();
		return handlerFinished;
	});

	const delivery = sendMessageUntilAcknowledged(
		{ error: "Could not start microphone capture", type: "capture-error" },
		0,
	);
	void delivery.then(() => {
		deliveryFinished = true;
	});

	await handlerStarted;
	await Promise.resolve();
	expect(responseSent).toBeFalse();
	expect(deliveryFinished).toBeFalse();

	finishHandler(true);
	await delivery;
	expect(responseSent).toBeTrue();
	expect(deliveryFinished).toBeTrue();
});
