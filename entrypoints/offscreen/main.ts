import {
	extensionTranscriptionConfig,
	transcribeAudio,
	transcriptSegments,
} from "../../lib/api/transcription";
import {
	recoverPartialCapture,
	releaseCaptureResources,
	watchForStreamEnd,
} from "../../lib/audio/capture-resources";
import { microphoneConstraints } from "../../lib/audio/microphone";
import { mixStreams } from "../../lib/audio/mixer";
import { tabAudioConstraints } from "../../lib/audio/tab-capture";
import { bffExtensionWebSocketUrl } from "../../lib/bff/client";
import {
	extensionRecordingStatus,
	saveExtensionRecording,
	saveRecoveredExtensionRecordings,
} from "../../lib/bff/library";
import { crashLog, logError } from "../../lib/crash-log";
import {
	onMessage,
	sendMessage,
	sendMessageUntilAcknowledged,
} from "../../lib/messaging/bridge";
import { sendFinalCaptureMessage } from "../../lib/messaging/capture-terminal";
import type {
	AudioSource,
	DictationTranslation,
	StartCapture,
} from "../../lib/messaging/types";
import { AUDIO_FORMAT } from "../../src/core/constants";
import type { TranscriptSegment } from "../../src/core/models";
import type { RealtimeToken } from "../../src/core/realtime-session";
import { type PcmCapture, createPcmCapture } from "../../web/src/capture";
import {
	type WebRealtimeSession,
	startWebRealtime,
} from "../../web/src/realtime";
import {
	type ScratchCapture,
	type ScratchRecording,
	type ScratchStorage,
	createScratchStorage,
} from "../../web/src/scratch-storage";

interface AudioPipeline {
	bffOrigin: string;
	captureId: string;
	cleanupContexts: AudioContext[];
	diarization: boolean;
	language: string;
	pcm: PcmCapture;
	pendingEncoded: Promise<void>;
	partiallyRecovered: boolean;
	recorder: MediaRecorder;
	recordingType: "meeting" | "voice";
	realtime: WebRealtimeSession;
	realtimeSegments: TranscriptSegment[];
	scratch: ScratchCapture;
	scratchStorage: ScratchStorage;
	source: AudioSource;
	sourceStreams: MediaStream[];
	stopping: boolean;
	translation?: DictationTranslation;
}

let pipelines: AudioPipeline[] = [];
let currentCaptureId: string | undefined;

function reportCaptureError(captureId: string, error: string) {
	return sendFinalCaptureMessage({ captureId, error, type: "capture-error" });
}

async function getMicrophoneStream(deviceId: string | null | undefined) {
	return navigator.mediaDevices.getUserMedia({
		audio: microphoneConstraints(deviceId ?? null),
	});
}

function messageTokens(tokens: readonly RealtimeToken[]) {
	return tokens.map((token) => ({
		confidence: 1,
		end_ms: token.endMs ?? 0,
		is_final: token.isFinal,
		...(token.speaker ? { speaker: token.speaker } : {}),
		start_ms: token.startMs ?? 0,
		text: token.text,
	}));
}

function timedSegments(tokens: readonly RealtimeToken[]): TranscriptSegment[] {
	return tokens.flatMap((token) => {
		const startMs = token.startMs;
		const endMs = token.endMs;
		if (
			!token.isFinal ||
			typeof startMs !== "number" ||
			typeof endMs !== "number" ||
			!Number.isSafeInteger(startMs) ||
			!Number.isSafeInteger(endMs) ||
			startMs < 0 ||
			endMs < startMs ||
			!token.text.trim()
		)
			return [];
		return [
			{
				endMs,
				...(token.speaker ? { speaker: token.speaker } : {}),
				startMs,
				text: token.text,
			},
		];
	});
}

onMessage((msg) => {
	if (msg.type === "start-capture") {
		void startCapture(msg);
		return;
	}
	if (msg.type === "stop-capture") {
		void stopCapture();
		return;
	}
	if (msg.type === "forceClose") {
		void discardCapture();
	}
});

console.log("[offscreen] loaded");

async function createPipeline({
	bffOrigin,
	captureId,
	cleanupContexts = [],
	diarization,
	language,
	recordingType,
	source,
	sourceStreams,
	stream,
	translation,
}: {
	bffOrigin: string;
	captureId: string;
	cleanupContexts?: AudioContext[];
	diarization: boolean;
	language: string;
	recordingType: "meeting" | "voice";
	source: AudioSource;
	sourceStreams: MediaStream[];
	stream: MediaStream;
	translation?: DictationTranslation;
}): Promise<AudioPipeline> {
	const scratchStorage = createScratchStorage();
	let pcm: PcmCapture | undefined;
	let realtime: WebRealtimeSession | undefined;
	try {
		const scratch = await scratchStorage.start(
			translation ? "translation" : recordingType,
		);
		const recorderRef: { value?: MediaRecorder } = {};
		const realtimeSegments: TranscriptSegment[] = [];
		realtime = startWebRealtime({
			config: {
				audio_format: AUDIO_FORMAT.wireFormat,
				num_channels: AUDIO_FORMAT.channels,
				sample_rate: AUDIO_FORMAT.sampleRate,
				...extensionTranscriptionConfig({
					enable_speaker_diarization: diarization,
					language_hints: language.split(","),
					translation,
				}),
			},
			endpoint: bffExtensionWebSocketUrl(bffOrigin),
			onTokens(tokens) {
				const message = messageTokens(tokens);
				realtimeSegments.push(...timedSegments(tokens));
				if (message.length)
					void sendMessage({
						captureId,
						type: "capture-tokens",
						source,
						tokens: message,
					});
			},
		});
		pcm = await createPcmCapture({
			onChunkRotation: () => {
				if (recorderRef.value?.state === "recording")
					recorderRef.value.requestData();
			},
			onFrame: (frame) => {
				scratch.appendPcm(frame);
				realtime?.sendAudio(frame);
			},
			onLevel: () => undefined,
			stream,
		});
		const recorder = new MediaRecorder(pcm.destination.stream);
		recorderRef.value = recorder;
		const pipeline: AudioPipeline = {
			bffOrigin,
			captureId,
			cleanupContexts,
			diarization,
			language,
			pcm,
			pendingEncoded: Promise.resolve(),
			partiallyRecovered: false,
			recorder,
			recordingType,
			realtime,
			realtimeSegments,
			scratch,
			scratchStorage,
			source,
			sourceStreams,
			stopping: false,
			translation,
		};
		recorder.addEventListener("dataavailable", (event) => {
			if (!event.data.size) return;
			pipeline.pendingEncoded = pipeline.pendingEncoded
				.then(() => scratch.appendEncoded(event.data))
				.catch((error) => logError("offscreen:scratch", error));
		});
		recorder.start();
		return pipeline;
	} catch (error) {
		realtime?.close();
		await releaseCaptureResources([], pcm ? [pcm.audioContext] : []);
		scratchStorage.close();
		throw error;
	}
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
	if (pipelines.length === 0 && currentCaptureId) {
		void reportCaptureError(currentCaptureId, message);
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
	if (pipelines.length === 0 && currentCaptureId) {
		void reportCaptureError(currentCaptureId, message);
	}
});

async function startCapture(msg: StartCapture) {
	currentCaptureId = msg.captureId;
	const startupStreams: MediaStream[] = [];
	const startupContexts: AudioContext[] = [];
	try {
		await queueScratchRecovery(msg.bffOrigin);
		if (msg.mode === "meeting") {
			if (!msg.streamId)
				throw new Error("Could not capture the selected browser tab");
			const micStream = await getMicrophoneStream(msg.microphoneDeviceId);
			startupStreams.push(micStream);
			const tabStream = await navigator.mediaDevices.getUserMedia(
				tabAudioConstraints(msg.streamId) as unknown as MediaStreamConstraints,
			);
			startupStreams.push(tabStream);
			const mixerContext = new AudioContext();
			startupContexts.push(mixerContext);
			const { stream: mixedStream } = mixStreams(
				mixerContext,
				tabStream,
				micStream,
			);
			await mixerContext.resume();
			const pipeline = await createPipeline({
				bffOrigin: msg.bffOrigin,
				captureId: msg.captureId,
				cleanupContexts: [mixerContext],
				diarization: msg.diarization,
				language: msg.language,
				recordingType: "meeting",
				source: "tab",
				sourceStreams: [micStream, tabStream, mixedStream],
				stream: mixedStream,
				translation: msg.translation,
			});
			pipelines = [pipeline];
			watchForStreamEnd(tabStream, () => {
				recoverPartialCapture(pipeline, (partiallyRecovered) => {
					void stopCapture(partiallyRecovered);
				});
			});
			startupStreams.length = 0;
			startupContexts.length = 0;
		} else {
			const micStream = await getMicrophoneStream(msg.microphoneDeviceId);
			startupStreams.push(micStream);
			pipelines = [
				await createPipeline({
					bffOrigin: msg.bffOrigin,
					captureId: msg.captureId,
					diarization: msg.diarization,
					language: msg.language,
					recordingType: "voice",
					source: "mic",
					sourceStreams: [micStream],
					stream: micStream,
					translation: msg.translation,
				}),
			];
			startupStreams.length = 0;
		}
		await sendMessage({ captureId: msg.captureId, type: "capture-ready" });
	} catch (error) {
		await releaseCaptureResources(startupStreams, startupContexts);
		logError("offscreen:startCapture", error);
		await reportCaptureError(
			msg.captureId,
			error instanceof Error ? error.message : "Failed to start capture",
		);
	}
}

async function queueScratchRecovery(bffOrigin: string) {
	const storage = createScratchStorage();
	try {
		const recovered = await storage.recover();
		if (recovered.length > 0)
			await saveRecoveredExtensionRecordings(recovered, storage, bffOrigin);
	} catch (error) {
		logError("offscreen:recovery", error);
	} finally {
		storage.close();
	}
}

async function stopCapture(partiallyRecovered = false) {
	const activePipelines = pipelines;
	pipelines = [];
	for (const pipeline of activePipelines) {
		pipeline.stopping = true;
		pipeline.partiallyRecovered ||= partiallyRecovered;
		try {
			const recording = await stopAndCollect(pipeline);
			let text = "";
			let segments: readonly TranscriptSegment[] = [];
			let transcribed = false;
			let error: Error | undefined;
			try {
				text = await pipeline.realtime.result;
				segments = pipeline.realtimeSegments;
				transcribed = Boolean(text.trim());
			} catch (cause) {
				logError("offscreen:realtime", cause);
			}
			try {
				if (
					!transcribed ||
					(pipeline.recordingType === "meeting" &&
						pipeline.diarization &&
						!segments.some((segment) => segment.speaker))
				) {
					const result = await transcribeAudio(
						recording.audio,
						{
							enable_speaker_diarization: pipeline.diarization,
							language_hints: pipeline.language.split(","),
							translation: pipeline.translation,
						},
						pipeline.bffOrigin,
					);
					text = result.text;
					segments = transcriptSegments(result.tokens);
					transcribed = true;
				}
			} catch (cause) {
				logError("offscreen:transcribe", cause);
				error =
					cause instanceof Error ? cause : new Error("Transcription failed");
			}
			try {
				const type = pipeline.translation
					? "translation"
					: pipeline.recordingType;
				await pipeline.scratchStorage.updateMetadata(recording.id, {
					...(segments.length ? { segments } : {}),
					text,
					type,
				});
				await saveExtensionRecording(
					{
						audio: recording.audio,
						durationSeconds: recording.durationSeconds,
						...(segments.length ? { segments } : {}),
						status: extensionRecordingStatus({
							partiallyRecovered: pipeline.partiallyRecovered,
							transcribed,
							translation: Boolean(pipeline.translation),
						}),
						text,
						type,
					},
					pipeline.bffOrigin,
					recording.id,
				);
				await pipeline.scratch.discard();
			} catch (cause) {
				logError("offscreen:library", cause);
				error =
					cause instanceof Error
						? cause
						: new Error("Could not save the recording to the library");
			}
			if (transcribed) {
				await sendMessageUntilAcknowledged({
					captureId: pipeline.captureId,
					type: "capture-complete",
					text,
					source: pipeline.source,
				});
			}
			if (error) {
				await reportCaptureError(pipeline.captureId, error.message);
			} else {
				await sendFinalCaptureMessage({
					captureId: pipeline.captureId,
					type: "capture-persisted",
					source: pipeline.source,
				});
			}
		} catch (error) {
			logError("offscreen:stop", error);
			await reportCaptureError(
				pipeline.captureId,
				error instanceof Error ? error.message : "Transcription failed",
			);
		} finally {
			pipeline.scratchStorage.close();
		}
	}
}

async function discardCapture() {
	const activePipelines = pipelines;
	pipelines = [];
	await Promise.all(activePipelines.map(stopAndDiscard));
}

async function stopAndCollect(
	pipeline: AudioPipeline,
): Promise<ScratchRecording> {
	try {
		await stopRecorder(pipeline.recorder);
		await pipeline.pendingEncoded;
		pipeline.realtime.finalize();
		await stopPipelineResources(pipeline);
		return pipeline.scratch.complete();
	} catch (error) {
		pipeline.realtime.close();
		throw error;
	}
}

async function stopAndDiscard(pipeline: AudioPipeline) {
	pipeline.stopping = true;
	pipeline.realtime.close();
	await stopRecorder(pipeline.recorder).catch(() => undefined);
	await pipeline.pendingEncoded;
	await stopPipelineResources(pipeline);
	try {
		await pipeline.scratch.discard();
	} finally {
		pipeline.scratchStorage.close();
	}
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
	await releaseCaptureResources(pipeline.sourceStreams, [
		...pipeline.cleanupContexts,
		pipeline.pcm.audioContext,
	]);
}
