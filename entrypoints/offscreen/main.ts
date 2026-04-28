import { mixStreams } from "../../lib/audio/mixer";
import { crashLog, logError } from "../../lib/crash-log";
import { onMessage, sendMessage } from "../../lib/messaging/bridge";
import type { AudioSource, StartCapture } from "../../lib/messaging/types";
import { RealtimeWSClient } from "../../lib/realtime/ws-client";

interface AudioPipeline {
	stream: MediaStream;
	context: AudioContext;
	cleanupContexts: AudioContext[];
	worklet: AudioWorkletNode;
	wsClient: RealtimeWSClient;
	source: AudioSource;
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
	}
});

console.log("[offscreen] loaded");

async function createPipeline(
	stream: MediaStream,
	source: AudioSource,
	accessToken: string,
	language: string,
	diarization: boolean,
): Promise<AudioPipeline> {
	const context = new AudioContext({ sampleRate: 16000 });

	const wsClient = new RealtimeWSClient({
		accessToken,
		config: {
			audio_format: "s16le",
			sample_rate: 16000,
			num_channels: 1,
			language_hints: [language],
			enable_speaker_diarization: diarization,
		},
		onTokens: (tokens) => {
			sendMessage({ type: "capture-tokens", tokens, source });
		},
		onComplete: (text) => {
			wsClient.close();
			sendMessage({ type: "capture-complete", text, source });
		},
		onError: (error) => {
			crashLog("offscreen:ws", "error", error);
			sendMessage({ type: "capture-error", error });
		},
		onWarning: (warning) => {
			crashLog("offscreen:ws", "warn", warning);
		},
		onReady: () => {},
	});
	wsClient.connect();

	const workletUrl = chrome.runtime.getURL("/pcm-worklet.js");
	await context.audioWorklet.addModule(workletUrl);

	const audioSource = context.createMediaStreamSource(stream);
	const worklet = new AudioWorkletNode(context, "pcm-encoder");

	worklet.port.onmessage = (event) => {
		if (event.data.pcm) {
			wsClient.sendAudio(event.data.pcm);
		}
	};

	audioSource.connect(worklet);
	worklet.connect(context.destination);

	return {
		stream,
		context,
		cleanupContexts: [],
		worklet,
		wsClient,
		source,
	};
}

self.addEventListener("error", (event) => {
	const msg =
		event.error instanceof Error ? event.error.message : event.message;
	crashLog(
		"offscreen",
		"error",
		msg,
		event.error instanceof Error ? event.error.stack : undefined,
	);
	// Only kill recording for fatal errors during capture setup, not transient issues
	if (pipelines.length === 0) {
		sendMessage({ type: "capture-error", error: msg });
	}
});

self.addEventListener("unhandledrejection", (event) => {
	const msg =
		event.reason instanceof Error
			? event.reason.message
			: String(event.reason ?? "Unhandled rejection");
	crashLog(
		"offscreen",
		"error",
		msg,
		event.reason instanceof Error ? event.reason.stack : undefined,
	);
	// Only kill recording for fatal errors during capture setup, not transient issues
	if (pipelines.length === 0) {
		sendMessage({ type: "capture-error", error: msg });
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
				} catch (err) {
					crashLog(
						"offscreen:tabAudio",
						"warn",
						`Tab audio capture failed, falling back to mic-only: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			} else {
				crashLog(
					"offscreen:tabAudio",
					"warn",
					"Source has no capturable audio, using mic-only",
				);
			}

			if (tabStream) {
				const mixerContext = new AudioContext();
				const { stream: mixedStream } = mixStreams(
					mixerContext,
					tabStream,
					micStream,
				);

				const meetingPipeline = await createPipeline(
					mixedStream,
					"tab",
					msg.accessToken,
					msg.language,
					msg.diarization,
				);
				meetingPipeline.cleanupContexts.push(mixerContext);
				pipelines = [meetingPipeline];
			} else {
				// Fallback: mic-only when system audio is unavailable
				const micPipeline = await createPipeline(
					micStream,
					"mic",
					msg.accessToken,
					msg.language,
					msg.diarization,
				);
				pipelines = [micPipeline];
			}
		} else {
			// Voice mode: mic only, single pipeline
			const micStream = await navigator.mediaDevices.getUserMedia({
				audio: true,
			});
			const micPipeline = await createPipeline(
				micStream,
				"mic",
				msg.accessToken,
				msg.language,
				false,
			);
			pipelines = [micPipeline];
		}
	} catch (err) {
		logError("offscreen:startCapture", err);
		sendMessage({
			type: "capture-error",
			error: err instanceof Error ? err.message : "Failed to start capture",
		});
	}
}

async function stopCapture() {
	// Stop all pipelines
	for (const pipeline of pipelines) {
		pipeline.worklet.disconnect();
		for (const track of pipeline.stream.getTracks()) {
			track.stop();
		}

		const finalText = pipeline.wsClient.getFinalText();
		pipeline.wsClient.finalize();

		// Force-complete after 3s if server doesn't respond
		let completed = false;
		// biome-ignore lint/suspicious/noExplicitAny: accessing private opts for force-complete timeout
		const originalOnComplete = (pipeline.wsClient as any).opts.onComplete;
		// biome-ignore lint/suspicious/noExplicitAny: accessing private opts for force-complete timeout
		(pipeline.wsClient as any).opts.onComplete = (text: string) => {
			if (completed) return;
			completed = true;
			originalOnComplete(text);
		};
		const { wsClient, source } = pipeline;
		setTimeout(() => {
			if (!completed) {
				completed = true;
				wsClient.close();
				sendMessage({ type: "capture-complete", text: finalText, source });
			}
		}, 3000);

		for (const context of pipeline.cleanupContexts) {
			await context.close();
		}
		await pipeline.context.close();
	}
	pipelines = [];
}
