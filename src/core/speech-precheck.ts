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
	const preCheck = createSpeechPreCheckAccumulator();
	preCheck.push(samples);
	return preCheck.result();
}

export function createSpeechPreCheckAccumulator() {
	const frame = new Float32Array(VAD.frameSamples);
	let frameLength = 0;
	let unreadable = false;
	let voicedSamples = 0;

	return {
		push(samples: PcmSamples | null) {
			if (!samples) {
				unreadable = true;
				return;
			}
			for (const value of samples) {
				if (!Number.isFinite(value)) {
					unreadable = true;
					return;
				}
				frame[frameLength] =
					samples instanceof Int16Array ? value / 32_768 : value;
				frameLength += 1;
				if (frameLength !== VAD.frameSamples) continue;
				if (frameHasSpeech(frame, 0)) voicedSamples += VAD.frameSamples;
				frameLength = 0;
			}
		},
		result(): SpeechPreCheckResult {
			if (unreadable) return { hasSpeech: true, reason: "unreadable" };
			const minimumVoicedSamples =
				(AUDIO_FORMAT.sampleRate * VAD.minimumVoicedDurationMs) /
				TIME.millisecondsPerSecond;
			return voicedSamples >= minimumVoicedSamples
				? { hasSpeech: true }
				: { hasSpeech: false, reason: "silence" };
		},
	};
}
