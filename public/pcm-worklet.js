// AudioWorkletProcessor: Float32 → Int16 PCM s16le
// ~100ms chunks at 16kHz mono = 3200 bytes = 1600 samples
class PCMEncoderProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.buffer = new Int16Array(1600);
		this.offset = 0;
	}

	process(inputs) {
		const input = inputs[0]?.[0];
		if (!input) return true;

		for (let i = 0; i < input.length; i++) {
			const s = Math.max(-1, Math.min(1, input[i]));
			this.buffer[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;

			if (this.offset >= this.buffer.length) {
				const copy = this.buffer.slice();
				this.port.postMessage({ pcm: copy.buffer }, [copy.buffer]);
				this.offset = 0;
			}
		}

		return true;
	}
}

registerProcessor("pcm-encoder", PCMEncoderProcessor);
