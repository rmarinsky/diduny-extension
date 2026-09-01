import { expect, test } from "bun:test";
import { VAD, speechPreCheck } from "../src/core";

function voicedFrames(count) {
	return new Float32Array(VAD.frameSamples * count).fill(0.02);
}

test("classifies silence and a too-short utterance as no speech without any transport", () => {
	expect(speechPreCheck(new Float32Array(VAD.frameSamples * 20))).toEqual({
		hasSpeech: false,
		reason: "silence",
	});
	expect(speechPreCheck(voicedFrames(8))).toEqual({
		hasSpeech: false,
		reason: "silence",
	});
});

test("passes sufficiently long voiced audio and fails open for unreadable input", () => {
	expect(speechPreCheck(voicedFrames(9))).toEqual({ hasSpeech: true });
	expect(
		speechPreCheck(new Int16Array(VAD.frameSamples * 9).fill(655)),
	).toEqual({ hasSpeech: true });
	expect(speechPreCheck(new Int16Array(VAD.frameSamples * 9).fill(1))).toEqual({
		hasSpeech: false,
		reason: "silence",
	});
	expect(speechPreCheck(null)).toEqual({
		hasSpeech: true,
		reason: "unreadable",
	});
});
