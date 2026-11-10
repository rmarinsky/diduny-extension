import { expect, test } from "bun:test";
import { mixStreams } from "./mixer";

class AudioNodeDouble {
	connections: AudioNodeDouble[] = [];
	gain = { value: 0 };

	connect(destination: AudioNodeDouble) {
		this.connections.push(destination);
		return destination;
	}
}

test("plays tab audio locally while sending tab and microphone audio to the capture stream", () => {
	const tabStream = {} as MediaStream;
	const microphoneStream = {} as MediaStream;
	const tabSource = new AudioNodeDouble();
	const microphoneSource = new AudioNodeDouble();
	const tabGain = new AudioNodeDouble();
	const microphoneGain = new AudioNodeDouble();
	const captureDestination = new AudioNodeDouble() as AudioNodeDouble & {
		stream: MediaStream;
	};
	const mixedStream = {} as MediaStream;
	captureDestination.stream = mixedStream;
	const localSpeakers = new AudioNodeDouble();
	const gains = [tabGain, microphoneGain];
	const context = {
		createGain: () => {
			const gain = gains.shift();
			if (!gain) throw new Error("Unexpected gain node request");
			return gain;
		},
		createMediaStreamDestination: () => captureDestination,
		createMediaStreamSource: (stream: MediaStream) =>
			stream === tabStream ? tabSource : microphoneSource,
		destination: localSpeakers,
	} as unknown as AudioContext;

	const mixed = mixStreams(context, tabStream, microphoneStream);

	expect(mixed.stream).toBe(mixedStream);
	expect(tabSource.connections).toEqual([tabGain]);
	expect(tabGain.connections).toEqual([captureDestination, localSpeakers]);
	expect(microphoneSource.connections).toEqual([microphoneGain]);
	expect(microphoneGain.connections).toEqual([captureDestination]);
});
