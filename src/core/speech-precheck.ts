import { AUDIO_FORMAT, TIME, VAD } from "./constants";

export type SpeechPreCheckResult =
	| { hasSpeech: false; reason: "silence" }
	| { hasSpeech: true; reason?: "unreadable" };

type PcmSamples = Float32Array | Int16Array;

function frameHasSpeech(samples: PcmSamples, offset: number) {
	let sum = 0;
	let peak = 0;
	for (let index = offset; index < offset + VAD.frameSamples; index += 1) {
		const value = samples[index];
		if (value === undefined || !Number.isFinite(value)) return null;
		const sample = samples instanceof Int16Array ? value / 32_768 : value;
		const magnitude = Math.abs(sample);
		sum += sample * sample;
		peak = Math.max(peak, magnitude);
	}
	const rms = Math.sqrt(sum / VAD.frameSamples);
	return rms >= VAD.minimumRms && peak >= VAD.minimumPeak;
}

export function speechPreCheck(
	samples: PcmSamples | null,
): SpeechPreCheckResult {
	if (!samples) return { hasSpeech: true, reason: "unreadable" };
	let voicedSamples = 0;
	for (
		let offset = 0;
		offset + VAD.frameSamples <= samples.length;
		offset += VAD.frameSamples
	) {
		const voiced = frameHasSpeech(samples, offset);
		if (voiced === null) return { hasSpeech: true, reason: "unreadable" };
		if (voiced) voicedSamples += VAD.frameSamples;
	}
	const minimumVoicedSamples =
		(AUDIO_FORMAT.sampleRate * VAD.minimumVoicedDurationMs) /
		TIME.millisecondsPerSecond;
	return voicedSamples >= minimumVoicedSamples
		? { hasSpeech: true }
		: { hasSpeech: false, reason: "silence" };
}
