export async function closeAudioContexts(contexts: readonly AudioContext[]) {
	for (const context of new Set(contexts))
		await context.close().catch(() => undefined);
}

export async function releaseCaptureResources(
	streams: readonly MediaStream[],
	contexts: readonly AudioContext[],
) {
	for (const track of new Set(streams.flatMap((stream) => stream.getTracks())))
		track.stop();
	await closeAudioContexts(contexts);
}

export function watchForStreamEnd(stream: MediaStream, onEnd: () => void) {
	let handled = false;
	const tracks = stream.getTracks();
	const ended = () => {
		if (handled) return;
		handled = true;
		onEnd();
	};
	for (const track of tracks) {
		track.addEventListener("ended", ended);
	}
	if (tracks.some((track) => track.readyState === "ended")) ended();
}

export function recoverPartialCapture(
	capture: { partiallyRecovered: boolean; stopping: boolean },
	stop: (partiallyRecovered: true) => void,
) {
	if (capture.stopping) return;
	capture.partiallyRecovered = true;
	stop(true);
}
