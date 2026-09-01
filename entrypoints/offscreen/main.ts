import { transcribeAudio } from "../../lib/api/transcription";
import { mixStreams } from "../../lib/audio/mixer";
import { crashLog, logError } from "../../lib/crash-log";
import { onMessage, sendMessage } from "../../lib/messaging/bridge";
import type { AudioSource, StartCapture } from "../../lib/messaging/types";

interface AudioPipeline {
	bffOrigin: string;
	chunks: Blob[];
	cleanupContexts: AudioContext[];
	diarization: boolean;
	language: string;
	recorder: MediaRecorder;
	source: AudioSource;
	stream: MediaStream;
}

type ChromeDesktopAudioConstraints = MediaTrackConstraints & {
	mandatory: {
		chromeMediaSource: "desktop";
		chromeMediaSourceId: string;
	};
};

let pipelines: AudioPipeline[] = [];

onMessage(async (msg) => {
	if (msg.type === "start-capture") {
		await startCapture(msg);
	} else if (msg.type === "stop-capture") {
		await stopCapture();
	} else if (msg.type === "forceClose") {
		await discardCapture();
	}
});

console.log("[offscreen] loaded");

function createPipeline(
	stream: MediaStream,
	source: AudioSource,
	bffOrigin: string,
	language: string,
	diarization: boolean,
): AudioPipeline {
	const chunks: Blob[] = [];
	const recorder = new MediaRecorder(stream);
	recorder.addEventListener("dataavailable", (event) => {
		if (event.data.size > 0) chunks.push(event.data);
	});
	recorder.start();
	return {
		bffOrigin,
		chunks,
		cleanupContexts: [],
		diarization,
		language,
		recorder,
		source,
		stream,
	};
}

self.addEventListener("error", (event) => {
	const message =
		event.error instanceof Error ? event.error.message : event.message;
	crashLog(
		"offscreen",
		"error",
		message,
		event.error instanceof Error ? event.error.stack : undefined,
	);
	if (pipelines.length === 0) {
		sendMessage({ type: "capture-error", error: message });
	}
});

self.addEventListener("unhandledrejection", (event) => {
	const message =
		event.reason instanceof Error
			? event.reason.message
			: String(event.reason ?? "Unhandled rejection");
	crashLog(
		"offscreen",
		"error",
		message,
		event.reason instanceof Error ? event.reason.stack : undefined,
	);
	if (pipelines.length === 0) {
		sendMessage({ type: "capture-error", error: message });
	}
});

async function startCapture(msg: StartCapture) {
	try {
		if (msg.mode === "meeting" && msg.streamId) {
			const micStream = await navigator.mediaDevices.getUserMedia({
				audio: true,
			});

			let tabStream: MediaStream | null = null;
			if (msg.canRequestAudioTrack) {
				const desktopAudioConstraints: ChromeDesktopAudioConstraints = {
					mandatory: {
						chromeMediaSource: "desktop",
						chromeMediaSourceId: msg.streamId,
					},
				};

				try {
					tabStream = await navigator.mediaDevices.getUserMedia({
						audio: desktopAudioConstraints,
					});
				} catch (error) {
					crashLog(
						"offscreen:tabAudio",
						"warn",
						`Tab audio capture failed, falling back to mic-only: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}

			if (tabStream) {
				const mixerContext = new AudioContext();
				const { stream: mixedStream } = mixStreams(
					mixerContext,
					tabStream,
					micStream,
				);
				await mixerContext.resume();
				const pipeline = createPipeline(
					mixedStream,
					"tab",
					msg.bffOrigin,
					msg.language,
					msg.diarization,
				);
				pipeline.cleanupContexts.push(mixerContext);
				pipelines = [pipeline];
			} else {
				pipelines = [
					createPipeline(
						micStream,
						"mic",
						msg.bffOrigin,
						msg.language,
						msg.diarization,
					),
				];
			}
		} else {
			const micStream = await navigator.mediaDevices.getUserMedia({
				audio: true,
			});
			pipelines = [
				createPipeline(micStream, "mic", msg.bffOrigin, msg.language, false),
			];
		}
		await sendMessage({ type: "capture-ready" });
	} catch (error) {
		logError("offscreen:startCapture", error);
		sendMessage({
			type: "capture-error",
			error: error instanceof Error ? error.message : "Failed to start capture",
		});
	}
}

async function stopCapture() {
	const activePipelines = pipelines;
	pipelines = [];
	for (const pipeline of activePipelines) {
		try {
			const audio = await stopAndCollect(pipeline);
			const result = await transcribeAudio(
				audio,
				{
					enable_speaker_diarization: pipeline.diarization,
					language_hints: pipeline.language.split(","),
				},
				pipeline.bffOrigin,
			);
			await sendMessage({
				type: "capture-complete",
				text: result.text,
				source: pipeline.source,
			});
		} catch (error) {
			logError("offscreen:transcribe", error);
			await sendMessage({
				type: "capture-error",
				error: error instanceof Error ? error.message : "Transcription failed",
			});
		}
	}
}

async function discardCapture() {
	const activePipelines = pipelines;
	pipelines = [];
	await Promise.all(activePipelines.map(stopAndDiscard));
}

async function stopAndCollect(pipeline: AudioPipeline): Promise<Blob> {
	await stopRecorder(pipeline.recorder);
	await stopPipelineResources(pipeline);
	return new Blob(pipeline.chunks, { type: pipeline.recorder.mimeType });
}

async function stopAndDiscard(pipeline: AudioPipeline) {
	if (pipeline.recorder.state !== "inactive") pipeline.recorder.stop();
	await stopPipelineResources(pipeline);
}

function stopRecorder(recorder: MediaRecorder): Promise<void> {
	if (recorder.state === "inactive") return Promise.resolve();
	return new Promise((resolve, reject) => {
		recorder.addEventListener("stop", () => resolve(), { once: true });
		recorder.addEventListener(
			"error",
			() => reject(new Error("Recorder failed")),
			{ once: true },
		);
		recorder.stop();
	});
}

async function stopPipelineResources(pipeline: AudioPipeline) {
	for (const track of pipeline.stream.getTracks()) track.stop();
	for (const context of pipeline.cleanupContexts) await context.close();
}
