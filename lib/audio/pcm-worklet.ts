// AudioWorkletProcessor that converts Float32 audio to Int16 PCM
// Registered as 'pcm-encoder' in AudioContext
const BUFFER_SIZE = 3200; // ~100ms at 16kHz mono (16000 * 0.1 * 2 bytes)

class PCMEncoderProcessor extends AudioWorkletProcessor {
	private buffer = new Int16Array(BUFFER_SIZE / 2);
	private offset = 0;

	process(inputs: Float32Array[][]): boolean {
		const input = inputs[0]?.[0];
		if (!input) return true;

		for (let i = 0; i < input.length; i++) {
			// Clamp and convert float32 [-1, 1] to int16 [-32768, 32767]
			const sample = input[i] ?? 0;
			const s = Math.max(-1, Math.min(1, sample));
			this.buffer[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;

			if (this.offset >= this.buffer.length) {
				this.port.postMessage({ pcm: this.buffer.slice().buffer }, [
					this.buffer.slice().buffer,
				]);
				this.offset = 0;
			}
		}

		return true;
	}
}

registerProcessor("pcm-encoder", PCMEncoderProcessor);
