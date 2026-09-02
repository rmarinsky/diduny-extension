import { expect, test } from "bun:test";
import { AUDIO_FORMAT } from "../../src/core/constants";
import { wavHeader } from "./wav";

test("writes a playable PCM WAV header from the surviving byte count", () => {
	const pcmBytes = AUDIO_FORMAT.sampleRate * 2;
	const header = new DataView(wavHeader(pcmBytes));

	expect(header.getUint32(4, true)).toBe(36 + pcmBytes);
	expect(header.getUint32(24, true)).toBe(AUDIO_FORMAT.sampleRate);
	expect(header.getUint16(34, true)).toBe(16);
	expect(header.getUint32(40, true)).toBe(pcmBytes);
});
