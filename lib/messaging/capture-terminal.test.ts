import { afterEach, expect, test } from "bun:test";
import { sendFinalCaptureMessage } from "./capture-terminal";

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");

afterEach(() => {
	if (originalChrome)
		Object.defineProperty(globalThis, "chrome", originalChrome);
	else Reflect.deleteProperty(globalThis, "chrome");
});

for (const message of [
	{
		captureId: "failed-capture",
		error: "Could not start microphone capture",
		type: "capture-error" as const,
	},
	{
		captureId: "persisted-capture",
		source: "mic" as const,
		type: "capture-persisted" as const,
	},
]) {
	test(`${message.type} requests cleanup only after observing its ACK`, async () => {
		let acknowledge!: (value: { acknowledged: true }) => void;
		const acknowledgement = new Promise<{ acknowledged: true }>((resolve) => {
			acknowledge = resolve;
		});
		const sent: unknown[] = [];
		Object.defineProperty(globalThis, "chrome", {
			configurable: true,
			value: {
				runtime: {
					sendMessage(next: unknown) {
						sent.push(next);
						return sent.length === 1
							? acknowledgement
							: Promise.resolve({ acknowledged: true });
					},
				},
			},
		});

		const delivery = sendFinalCaptureMessage(message);
		await Promise.resolve();
		expect(sent).toEqual([message]);

		acknowledge({ acknowledged: true });
		await delivery;
		expect(sent).toEqual([
			message,
			{ captureId: message.captureId, type: "close-offscreen" },
		]);
	});
}

test("retries the cleanup request until the background acknowledges it", async () => {
	let cleanupAttempts = 0;
	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		value: {
			runtime: {
				async sendMessage(message: { type?: string }) {
					if (message.type !== "close-offscreen") return { acknowledged: true };
					cleanupAttempts += 1;
					if (cleanupAttempts === 1)
						throw new Error("worker stopped before cleanup ACK");
					return { acknowledged: true };
				},
			},
		},
	});

	await sendFinalCaptureMessage({
		captureId: "capture-with-interrupted-cleanup",
		source: "mic",
		type: "capture-persisted",
	});
	expect(cleanupAttempts).toBe(2);
});
