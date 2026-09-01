// Web Audio mixer: combines tab audio + mic audio into a single stream
// Used for meeting recording mode

export interface MixedAudioResult {
	stream: MediaStream;
	tabGain: GainNode;
	micGain: GainNode;
	context: AudioContext;
}

export function mixStreams(
	context: AudioContext,
	tabStream: MediaStream,
	micStream: MediaStream,
): MixedAudioResult {
	const tabSource = context.createMediaStreamSource(tabStream);
	const micSource = context.createMediaStreamSource(micStream);

	const tabGain = context.createGain();
	const micGain = context.createGain();
	tabGain.gain.value = 1.0;
	micGain.gain.value = 1.0;

	const destination = context.createMediaStreamDestination();

	tabSource.connect(tabGain).connect(destination);
	tabGain.connect(context.destination);
	micSource.connect(micGain).connect(destination);

	return {
		stream: destination.stream,
		tabGain,
		micGain,
		context,
	};
}
