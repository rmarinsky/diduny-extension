import { AUDIO_FORMAT } from "../../src/core/constants";

const wavHeaderBytes = 44;

function ascii(view: DataView, offset: number, value: string) {
	for (let index = 0; index < value.length; index += 1)
		view.setUint8(offset + index, value.charCodeAt(index));
}

export function wavHeader(pcmBytes: number) {
	if (!Number.isSafeInteger(pcmBytes) || pcmBytes < 0)
		throw new Error("Invalid PCM byte length");
	const bytesPerSample = 2;
	const blockAlign = AUDIO_FORMAT.channels * bytesPerSample;
	const view = new DataView(new ArrayBuffer(wavHeaderBytes));
	ascii(view, 0, "RIFF");
	view.setUint32(4, 36 + pcmBytes, true);
	ascii(view, 8, "WAVE");
	ascii(view, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, AUDIO_FORMAT.channels, true);
	view.setUint32(24, AUDIO_FORMAT.sampleRate, true);
	view.setUint32(28, AUDIO_FORMAT.sampleRate * blockAlign, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bytesPerSample * 8, true);
	ascii(view, 36, "data");
	view.setUint32(40, pcmBytes, true);
	return view.buffer;
}
