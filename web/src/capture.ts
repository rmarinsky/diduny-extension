import { AUDIO_FORMAT, REALTIME } from "../../src/core/constants";
import pcmWorkletUrl from "./pcm-worklet.ts?worker&url";

export interface PcmCapture {
	audioContext: AudioContext;
	destination: MediaStreamAudioDestinationNode;
	stream: MediaStream;
	worklet: AudioWorkletNode;
}

export async function createPcmCapture({
	onFrame,
	onLevel,
	stream,
}: {
	onFrame(frame: Int16Array): void;
	onLevel(level: number): void;
	stream: MediaStream;
}): Promise<PcmCapture> {
	const audioContext = new AudioContext({
		sampleRate: AUDIO_FORMAT.sampleRate,
	});
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
			sampleRate: AUDIO_FORMAT.sampleRate,
			uiUpdatesPerSecond: REALTIME.uiUpdatesPerSecond,
		},
	});
	worklet.port.onmessage = (event: MessageEvent<unknown>) => {
		const message = event.data;
		if (!message || typeof message !== "object" || !("frame" in message))
			return;
		const { frame, level } = message as { frame: unknown; level?: unknown };
		if (frame instanceof ArrayBuffer) onFrame(new Int16Array(frame));
		if (typeof level === "number" && Number.isFinite(level)) onLevel(level);
	};
	source.connect(worklet);
	worklet.connect(destination);
	return { audioContext, destination, stream, worklet };
}
