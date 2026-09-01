import { closeAudioContexts } from "../../lib/audio/capture-resources";
import {
	AUDIO_FORMAT,
	LONG_RECORDING,
	REALTIME,
} from "../../src/core/constants";
import pcmWorkletUrl from "./pcm-worklet.ts?worker&url";

export interface PcmCapture {
	audioContext: AudioContext;
	destination: MediaStreamAudioDestinationNode;
	stream: MediaStream;
	worklet: AudioWorkletNode;
}

export function chunkRotationFrames(sampleRate: number) {
	return Math.round((sampleRate * LONG_RECORDING.chunkRotationMs) / 1_000);
}

export async function createPcmCapture({
	onChunkRotation = () => undefined,
	onFrame,
	onLevel,
	stream,
}: {
	onChunkRotation?: () => void;
	onFrame(frame: Int16Array): void;
	onLevel(level: number): void;
	stream: MediaStream;
}): Promise<PcmCapture> {
	const audioContext = new AudioContext({
		sampleRate: AUDIO_FORMAT.sampleRate,
	});
	try {
		await audioContext.audioWorklet.addModule(pcmWorkletUrl);
		await audioContext.resume();
		const source = audioContext.createMediaStreamSource(stream);
		const destination = audioContext.createMediaStreamDestination();
		const worklet = new AudioWorkletNode(audioContext, "diduny-pcm", {
			channelCount: AUDIO_FORMAT.channels,
			channelCountMode: "explicit",
			numberOfInputs: 1,
			numberOfOutputs: 1,
			processorOptions: {
				chunkRotationFrames: chunkRotationFrames(AUDIO_FORMAT.sampleRate),
				sampleRate: AUDIO_FORMAT.sampleRate,
				uiUpdatesPerSecond: REALTIME.uiUpdatesPerSecond,
			},
		});
		worklet.port.onmessage = (event: MessageEvent<unknown>) => {
			const message = event.data;
			if (!message || typeof message !== "object" || !("frame" in message))
				return;
			const { frame, level, rotate } = message as {
				frame: unknown;
				level?: unknown;
				rotate?: unknown;
			};
			if (frame instanceof ArrayBuffer) onFrame(new Int16Array(frame));
			if (typeof level === "number" && Number.isFinite(level)) onLevel(level);
			if (rotate === true) onChunkRotation();
		};
		source.connect(worklet);
		worklet.connect(destination);
		return { audioContext, destination, stream, worklet };
	} catch (error) {
		await closeAudioContexts([audioContext]);
		throw error;
	}
}
