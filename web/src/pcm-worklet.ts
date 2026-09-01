declare abstract class AudioWorkletProcessor {
	constructor(options?: { processorOptions?: Record<string, unknown> });
	readonly port: MessagePort;
	abstract process(
		inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Record<string, Float32Array>,
	): boolean;
}

declare function registerProcessor(
	name: string,
	processor: typeof AudioWorkletProcessor,
): void;

class PcmWorkletProcessor extends AudioWorkletProcessor {
	private readonly framesPerUpdate: number;
	private framesSinceUpdate = 0;

	constructor(options?: { processorOptions?: Record<string, unknown> }) {
		super(options);
		const sampleRate = options?.processorOptions?.sampleRate;
		const uiUpdatesPerSecond = options?.processorOptions?.uiUpdatesPerSecond;
		if (
			typeof sampleRate !== "number" ||
			typeof uiUpdatesPerSecond !== "number" ||
			sampleRate <= 0 ||
			uiUpdatesPerSecond <= 0
		) {
			throw new Error("Invalid Diduny audio format");
		}
		this.framesPerUpdate = sampleRate / uiUpdatesPerSecond;
	}

	process(inputs: Float32Array[][], outputs: Float32Array[][]) {
		const input = inputs[0]?.[0];
		const output = outputs[0]?.[0];
		if (!input || !output) return true;
		output.set(input);
		const frame = new Int16Array(input.length);
		let sum = 0;
		for (let index = 0; index < input.length; index += 1) {
			const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
			frame[index] = Math.round(sample * 32_767);
			sum += sample * sample;
		}
		this.framesSinceUpdate += input.length;
		if (this.framesSinceUpdate >= this.framesPerUpdate) {
			this.framesSinceUpdate = 0;
			this.port.postMessage(
				{
					frame: frame.buffer,
					level: Math.min(1, Math.sqrt(sum / input.length) * 8),
				},
				[frame.buffer],
			);
		} else {
			this.port.postMessage({ frame: frame.buffer }, [frame.buffer]);
		}
		return true;
	}
}

registerProcessor("diduny-pcm", PcmWorkletProcessor);
