import { expect, mock, test } from "bun:test";

mock.module("./pcm-worklet.ts?worker&url", () => ({
	default: "mock-pcm-worklet-url",
}));

const { chunkRotationFrames, createPcmCapture } = await import("./capture");

test("rotates PCM chunks after exactly five minutes at the configured sample rate", () => {
	expect(chunkRotationFrames(16_000)).toBe(4_800_000);
});

test("forwards one worklet rotation signal to one capture rotation request", async () => {
	const originalAudioContext = Object.getOwnPropertyDescriptor(
		globalThis,
		"AudioContext",
	);
	const originalAudioWorkletNode = Object.getOwnPropertyDescriptor(
		globalThis,
		"AudioWorkletNode",
	);
	const captureDestination = { stream: {} as MediaStream };
	let worklet: FakeAudioWorkletNode | undefined;
	let workletOptions: unknown;

	class FakeAudioContext {
		audioWorklet = { addModule: async () => undefined };

		async close() {}

		createMediaStreamDestination() {
			return captureDestination;
		}

		createMediaStreamSource() {
			return { connect: () => undefined };
		}

		async resume() {}
	}

	class FakeAudioWorkletNode {
		port: {
			onmessage: ((event: MessageEvent<unknown>) => void) | null;
		} = { onmessage: null };

		constructor(_context: unknown, _name: string, options: unknown) {
			worklet = this;
			workletOptions = options;
		}

		connect() {}
	}

	Object.defineProperty(globalThis, "AudioContext", {
		configurable: true,
		value: FakeAudioContext,
	});
	Object.defineProperty(globalThis, "AudioWorkletNode", {
		configurable: true,
		value: FakeAudioWorkletNode,
	});

	try {
		let rotationRequests = 0;
		await createPcmCapture({
			onChunkRotation: () => rotationRequests++,
			onFrame: () => undefined,
			onLevel: () => undefined,
			stream: {} as MediaStream,
		});
		if (!worklet) throw new Error("Expected capture to create a PCM worklet");
		expect(workletOptions).toEqual(
			expect.objectContaining({
				processorOptions: expect.objectContaining({
					chunkRotationFrames: 4_800_000,
				}),
			}),
		);

		worklet.port.onmessage?.({
			data: { frame: new Int16Array([1]).buffer, rotate: true },
		} as MessageEvent<unknown>);

		expect(rotationRequests).toBe(1);
	} finally {
		if (originalAudioContext) {
			Object.defineProperty(globalThis, "AudioContext", originalAudioContext);
		} else {
			Reflect.deleteProperty(globalThis, "AudioContext");
		}
		if (originalAudioWorkletNode) {
			Object.defineProperty(
				globalThis,
				"AudioWorkletNode",
				originalAudioWorkletNode,
			);
		} else {
			Reflect.deleteProperty(globalThis, "AudioWorkletNode");
		}
	}
});
