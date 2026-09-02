import { expect, test } from "bun:test";
import {
	closeAudioContexts,
	recoverPartialCapture,
	releaseCaptureResources,
	watchForStreamEnd,
} from "./capture-resources";

test("releases each capture track and audio context once", async () => {
	let stopped = 0;
	let closed = 0;
	const track = { stop: () => stopped++ } as unknown as MediaStreamTrack;
	const stream = {
		getTracks: () => [track],
	} as unknown as MediaStream;
	const context = {
		close: async () => closed++,
	} as unknown as AudioContext;

	await releaseCaptureResources([stream, stream], [context, context]);

	expect(stopped).toBe(1);
	expect(closed).toBe(1);
});

test("closes a PCM context when capture setup fails", async () => {
	let closed = 0;
	const context = {
		close: async () => closed++,
	} as unknown as AudioContext;

	await closeAudioContexts([context]);

	expect(closed).toBe(1);
});

test("reports a tab stream ending once even when multiple tracks end", () => {
	const callbacks: Array<() => void> = [];
	const track = {
		addEventListener(_event: string, callback: () => void) {
			callbacks.push(callback);
		},
	} as unknown as MediaStreamTrack;
	const stream = {
		getTracks: () => [track, track],
	} as unknown as MediaStream;
	let ended = 0;

	watchForStreamEnd(stream, () => ended++);
	for (const callback of callbacks) callback();

	expect(ended).toBe(1);
});

test("reports a tab stream that ended while the pipeline was starting", () => {
	const track = {
		addEventListener() {},
		readyState: "ended",
	} as unknown as MediaStreamTrack;
	const stream = {
		getTracks: () => [track],
	} as unknown as MediaStream;
	let ended = 0;

	watchForStreamEnd(stream, () => ended++);

	expect(ended).toBe(1);
});

test("marks a stream-ended capture partial before stopping it", () => {
	const capture = { partiallyRecovered: false, stopping: false };
	const stopRequests: boolean[] = [];

	recoverPartialCapture(capture, (partiallyRecovered) =>
		stopRequests.push(partiallyRecovered),
	);
	recoverPartialCapture({ ...capture, stopping: true }, (partiallyRecovered) =>
		stopRequests.push(partiallyRecovered),
	);

	expect(capture.partiallyRecovered).toBe(true);
	expect(stopRequests).toEqual([true]);
});
