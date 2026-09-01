import {
	type FormEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { isValidEmail, isValidOtp } from "../../src/core/auth-validation";
import { AUDIO_FORMAT, WEB_LATENCY_TARGET_MS } from "../../src/core/constants";
import type { RetentionPolicy } from "../../src/core/ports";
import type { RealtimeToken } from "../../src/core/realtime-session";
import { createSpeechPreCheckAccumulator } from "../../src/core/speech-precheck";
import { CommandPalette } from "./CommandPalette";
import { LibraryPane } from "./LibraryPane";
import {
	Onboarding,
	onboardingCompletedStorageKey,
	pendingRetentionStorageKey,
} from "./Onboarding";
import { SettingsPane } from "./SettingsPane";
import {
	audioCaptureConstraints,
	savedMicrophoneUnavailable,
} from "./audio-devices";
import {
	detectBrowserCapabilities,
	missingBrowserCapabilities,
} from "./capabilities";
import { createPcmCapture } from "./capture";
import {
	DEFAULT_SHORTCUT,
	appendTranscript,
	isEditableTarget,
	matchesCommandPaletteShortcut,
	matchesDictationShortcut,
} from "./dictation";
import {
	errorFromResponse,
	localProcessUnavailable,
	userErrorMessage,
} from "./errors";
import i18n, { setUiLocale } from "./i18n";
import { createWorkspaceInvalidationBus } from "./invalidation";
import { saveToLibrary } from "./library";
import {
	copyDocumentStyles,
	documentPictureInPictureApi,
} from "./picture-in-picture";
import { type WebRealtimeSession, startWebRealtime } from "./realtime";
import { acquireRecordingLock } from "./recording-lock";
import {
	type ScratchCapture,
	type ScratchRecording,
	type ScratchStorage,
	createScratchStorage,
} from "./scratch-storage";
import { getWorkspaceSettings, updateRetentionPolicy } from "./settings";
import {
	buildTranscriptionConfig,
	translationResultText,
	translationUrl,
} from "./translation";
import "./style.css";

type AuthState = "checking" | "otp-sent" | "signed-in" | "signed-out";
type CaptureState = "idle" | "recording" | "sending";
type WorkspaceView = "dictation" | "library" | "settings";

interface ActiveCapture {
	audioContext: AudioContext;
	mediaWrites: Promise<void>;
	mediaRecorder: MediaRecorder;
	realtime: WebRealtimeSession;
	scratch: ScratchCapture;
	speechPreCheck: ReturnType<typeof createSpeechPreCheckAccumulator>;
	stats: { sampleCount: number };
	stream: MediaStream;
	worklet: AudioWorkletNode;
}

interface SessionResponse {
	authenticated: boolean;
	email?: string;
}

interface TranscriptionResponse {
	text?: string;
}

async function bffJson<T>(path: string, init?: RequestInit): Promise<T> {
	let response: Response;
	try {
		response = await fetch(path, { credentials: "same-origin", ...init });
	} catch (error) {
		throw localProcessUnavailable(error);
	}
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok) throw errorFromResponse(response.status, body);
	return body as T;
}

async function stopRecorder(recorder: MediaRecorder) {
	if (recorder.state === "inactive") return;
	await new Promise<void>((resolve) => {
		recorder.addEventListener("stop", () => resolve(), { once: true });
		recorder.stop();
	});
}

function realtimeResultWithinBudget(result: Promise<string>) {
	return new Promise<string | undefined>((resolve) => {
		const timeout = window.setTimeout(
			() => resolve(undefined),
			WEB_LATENCY_TARGET_MS,
		);
		void result.then(
			(text) => {
				window.clearTimeout(timeout);
				resolve(text);
			},
			() => {
				window.clearTimeout(timeout);
				resolve(undefined);
			},
		);
	});
}

function releaseCapture(capture: ActiveCapture) {
	capture.realtime.close();
	capture.worklet.disconnect();
	for (const track of capture.stream.getTracks()) track.stop();
	void capture.audioContext.close();
}

function LiveTranscriptPanel({
	announceLiveTranscript,
	liveFinalText,
	liveProvisionalText,
	onReturnToPage,
}: {
	announceLiveTranscript: boolean;
	liveFinalText: string;
	liveProvisionalText: string;
	onReturnToPage?: () => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="live-transcript-panel">
			<section
				aria-hidden={announceLiveTranscript ? undefined : true}
				aria-label={t("liveTranscript.title")}
				className="live-transcript"
			>
				<h2>{t("liveTranscript.title")}</h2>
				<p aria-live={announceLiveTranscript ? "polite" : undefined}>
					<span className="token-state">{t("liveTranscript.final")}</span>
					<span data-testid="live-final-text">{liveFinalText}</span>
				</p>
				<p aria-hidden="true" className="provisional-token">
					<span className="token-state">{t("liveTranscript.provisional")}</span>
					<span data-testid="live-provisional-text">{liveProvisionalText}</span>
				</p>
			</section>
			{onReturnToPage ? (
				<button onClick={onReturnToPage} type="button">
					{t("floatingPanel.return")}
				</button>
			) : null}
		</div>
	);
}

export function App() {
	const [capabilities] = useState(detectBrowserCapabilities);
	const { t } = useTranslation();
	const missingCapabilities = missingBrowserCapabilities(capabilities);
	if (missingCapabilities.length) {
		return (
			<main className="shell capability-gate">
				<h1>{t("app.unsupportedBrowser")}</h1>
				<p>{t("app.unsupportedBrowserIntro")}</p>
				<ul>
					{missingCapabilities.map((capability) => (
						<li key={capability.key}>
							<strong>{t(`capability.${capability.key}.label`)}</strong> -{" "}
							{t(`capability.${capability.key}.reason`)}
						</li>
					))}
				</ul>
			</main>
		);
	}
	const [authState, setAuthState] = useState<AuthState>("checking");
	const [announceLiveTranscript, setAnnounceLiveTranscript] = useState(false);
	const [captureState, setCaptureState] = useState<CaptureState>("idle");
	const [documentText, setDocumentText] = useState("");
	const [dictationShortcut, setDictationShortcut] = useState(DEFAULT_SHORTCUT);
	const [email, setEmail] = useState("");
	const [elapsed, setElapsed] = useState(0);
	const [language, setLanguage] = useState("uk");
	const [level, setLevel] = useState(0);
	const [liveFinalText, setLiveFinalText] = useState("");
	const [liveProvisionalText, setLiveProvisionalText] = useState("");
	const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
	const [pictureInPictureContainer, setPictureInPictureContainer] =
		useState<HTMLElement | null>(null);
	const [microphoneDeviceId, setMicrophoneDeviceId] = useState<string | null>(
		null,
	);
	const [onboardingOpen, setOnboardingOpen] = useState(
		() => localStorage.getItem(onboardingCompletedStorageKey) !== "1",
	);
	const [otp, setOtp] = useState("");
	const [signedInEmail, setSignedInEmail] = useState("");
	const [status, setStatus] = useState(() => t("app.checkingSession"));
	const [translationMode, setTranslationMode] = useState(false);
	const [translationResult, setTranslationResult] = useState("");
	const [translationSourceLanguage, setTranslationSourceLanguage] =
		useState("uk");
	const [translationTargetLanguage, setTranslationTargetLanguage] =
		useState("en");
	const [translationText, setTranslationText] = useState("");
	const [view, setView] = useState<WorkspaceView>("dictation");
	const [workspaceRevision, setWorkspaceRevision] = useState(0);
	const captureRef = useRef<ActiveCapture | null>(null);
	const documentInput = useRef<HTMLTextAreaElement>(null);
	const holdCaptureRef = useRef(false);
	const onboardingReturnFocus = useRef<HTMLButtonElement>(null);
	const paletteReturnFocus = useRef<HTMLElement | null>(null);
	const pictureInPictureWindow = useRef<Window | null>(null);
	const recordingLockReleaseRef = useRef<(() => void) | null>(null);
	const recoveryAttemptedRef = useRef(false);
	const scratchStorageRef = useRef<ScratchStorage | null>(null);
	const stopHoldWhenReadyRef = useRef(false);
	const statusElement = useRef<HTMLParagraphElement>(null);
	const workspaceBusRef = useRef<ReturnType<
		typeof createWorkspaceInvalidationBus
	> | null>(null);

	const releaseRecordingLock = useCallback(() => {
		const release = recordingLockReleaseRef.current;
		recordingLockReleaseRef.current = null;
		release?.();
	}, []);

	const broadcastWorkspaceChange = useCallback(() => {
		workspaceBusRef.current?.invalidate();
	}, []);

	const invalidateWorkspace = useCallback(() => {
		broadcastWorkspaceChange();
		setWorkspaceRevision((revision) => revision + 1);
	}, [broadcastWorkspaceChange]);

	const scratchStorage = useCallback(() => {
		if (!scratchStorageRef.current)
			scratchStorageRef.current = createScratchStorage();
		return scratchStorageRef.current;
	}, []);

	const closeCommandPalette = useCallback(() => {
		setIsCommandPaletteOpen(false);
		queueMicrotask(() => paletteReturnFocus.current?.focus());
	}, []);

	const openCommandPalette = useCallback(() => {
		paletteReturnFocus.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		setIsCommandPaletteOpen(true);
	}, []);

	const closeFloatingPanel = useCallback(() => {
		const floating = pictureInPictureWindow.current;
		pictureInPictureWindow.current = null;
		setPictureInPictureContainer(null);
		if (floating && !floating.closed) floating.close();
	}, []);

	const openFloatingPanel = useCallback(async () => {
		const api = documentPictureInPictureApi();
		if (!api || pictureInPictureWindow.current) return;
		try {
			const floating = await api.requestWindow({ height: 260, width: 420 });
			copyDocumentStyles(document, floating.document);
			const container = floating.document.createElement("div");
			floating.document.body.append(container);
			pictureInPictureWindow.current = floating;
			floating.addEventListener(
				"pagehide",
				() => {
					if (pictureInPictureWindow.current !== floating) return;
					pictureInPictureWindow.current = null;
					setPictureInPictureContainer(null);
				},
				{ once: true },
			);
			setPictureInPictureContainer(container);
		} catch {
			setStatus(t("floatingPanel.unavailable"));
		}
	}, [t]);

	useEffect(
		() => () => {
			pictureInPictureWindow.current?.close();
			scratchStorageRef.current?.close();
		},
		[],
	);

	useEffect(() => {
		const bus = createWorkspaceInvalidationBus();
		workspaceBusRef.current = bus;
		const unsubscribe = bus.subscribe(() => {
			setWorkspaceRevision((revision) => revision + 1);
		});
		return () => {
			unsubscribe();
			bus.close();
			if (workspaceBusRef.current === bus) workspaceBusRef.current = null;
		};
	}, []);

	useEffect(() => {
		const flushScratch = () => {
			const capture = captureRef.current;
			if (capture) void capture.scratch.flush();
		};
		document.addEventListener("visibilitychange", flushScratch);
		return () => document.removeEventListener("visibilitychange", flushScratch);
	}, []);

	const refreshSession = useCallback(async () => {
		try {
			const session = await bffJson<SessionResponse>("/bff/auth/session");
			setAuthState(session.authenticated ? "signed-in" : "signed-out");
			setSignedInEmail(session.email ?? "");
			setStatus(
				session.authenticated
					? i18n.t("status.ready")
					: i18n.t("status.signIn"),
			);
		} catch (error) {
			setAuthState("signed-out");
			setStatus(
				userErrorMessage(localProcessUnavailable(error), i18n.t.bind(i18n)),
			);
		}
	}, []);

	useEffect(() => {
		void refreshSession();
	}, [refreshSession]);

	const recoverInterruptedCaptures = useCallback(async () => {
		const storage = scratchStorage();
		const recovered = await storage.recover();
		let didRecover = false;
		for (const recording of recovered) {
			try {
				await saveToLibrary({
					audio: recording.audio,
					durationSeconds: recording.durationSeconds,
					status: "partiallyRecovered",
					text: recording.text || t("recovery.untitledText"),
				});
				await storage.discard(recording.id);
				didRecover = true;
			} catch {
				// Keep the scratch manifest for a later BFF retry.
			}
		}
		if (didRecover) invalidateWorkspace();
	}, [invalidateWorkspace, scratchStorage, t]);

	useEffect(() => {
		if (authState !== "signed-in") return;
		const policy = localStorage.getItem(pendingRetentionStorageKey);
		if (policy !== "never") return;
		void updateRetentionPolicy("dictation", "never")
			.then(() => {
				localStorage.removeItem(pendingRetentionStorageKey);
				invalidateWorkspace();
			})
			.catch(() => {
				// Keep the preference for the next authenticated session.
			});
	}, [authState, invalidateWorkspace]);

	useEffect(() => {
		if (authState !== "signed-in") {
			recoveryAttemptedRef.current = false;
			return;
		}
		if (recoveryAttemptedRef.current) return;
		recoveryAttemptedRef.current = true;
		void recoverInterruptedCaptures();
	}, [authState, recoverInterruptedCaptures]);

	useEffect(() => {
		void workspaceRevision;
		if (authState !== "signed-in") {
			setAnnounceLiveTranscript(false);
			setDictationShortcut(DEFAULT_SHORTCUT);
			setMicrophoneDeviceId(null);
			setTranslationSourceLanguage("uk");
			setTranslationTargetLanguage("en");
			void setUiLocale("en");
			return;
		}
		void getWorkspaceSettings()
			.then(({ settings }) => {
				setAnnounceLiveTranscript(settings.announceLiveTranscript);
				setDictationShortcut(settings.dictationShortcut);
				setMicrophoneDeviceId(settings.microphoneDeviceId);
				setTranslationSourceLanguage(settings.translationSourceLanguage);
				setTranslationTargetLanguage(settings.translationTargetLanguage);
				void setUiLocale(settings.uiLocale);
			})
			.catch(() => {
				setAnnounceLiveTranscript(false);
				setDictationShortcut(DEFAULT_SHORTCUT);
				setMicrophoneDeviceId(null);
				setTranslationSourceLanguage("uk");
				setTranslationTargetLanguage("en");
				void setUiLocale("en");
			});
	}, [authState, workspaceRevision]);

	const cancelCapture = useCallback(async () => {
		holdCaptureRef.current = false;
		stopHoldWhenReadyRef.current = false;
		const capture = captureRef.current;
		if (!capture) {
			releaseRecordingLock();
			return;
		}
		captureRef.current = null;
		try {
			await stopRecorder(capture.mediaRecorder);
			await capture.mediaWrites;
			await capture.scratch.discard().catch(() => undefined);
		} finally {
			releaseCapture(capture);
			releaseRecordingLock();
			closeFloatingPanel();
			setCaptureState("idle");
			setElapsed(0);
			setLevel(0);
			setLiveFinalText("");
			setLiveProvisionalText("");
			setStatus(t("status.cancelled"));
		}
	}, [closeFloatingPanel, releaseRecordingLock, t]);

	const finishCapture = useCallback(async () => {
		stopHoldWhenReadyRef.current = false;
		const capture = captureRef.current;
		if (!capture) return;
		captureRef.current = null;
		setCaptureState("sending");
		setStatus(t("status.transcribing"));
		try {
			await stopRecorder(capture.mediaRecorder);
			const completeScratch = (() => {
				let completed: Promise<ScratchRecording> | undefined;
				return () => {
					completed ??= capture.mediaWrites.then(() =>
						capture.scratch.complete(),
					);
					return completed;
				};
			})();
			const preCheck = capture.speechPreCheck.result();
			if (!preCheck.hasSpeech) {
				await capture.mediaWrites;
				await capture.scratch.discard().catch(() => undefined);
				setStatus(t("status.noSpeech"));
				return;
			}

			let transcriptionText: string | undefined;
			capture.realtime.finalize();
			transcriptionText = await realtimeResultWithinBudget(
				capture.realtime.result,
			);
			if (!transcriptionText?.trim()) {
				capture.realtime.close();
				setStatus(t("status.realtimeFallback"));
			}
			if (!transcriptionText?.trim()) {
				const recording = await completeScratch();
				const form = new FormData();
				form.append(
					"audio",
					recording.audio,
					recording.audio.type.includes("wav")
						? "dictation.wav"
						: "dictation.webm",
				);
				const languageHints = translationMode
					? [translationSourceLanguage]
					: language
							.split(",")
							.map((value) => value.trim())
							.filter(Boolean);
				form.append(
					"config",
					new Blob(
						[
							JSON.stringify(
								buildTranscriptionConfig({
									languageHints,
									...(translationMode
										? {
												translation: {
													sourceLanguage: translationSourceLanguage,
													targetLanguage: translationTargetLanguage,
												},
											}
										: {}),
								}),
							),
						],
						{ type: "text/plain" },
					),
				);
				const result = await bffJson<TranscriptionResponse>(
					"/bff/api/transcriptions",
					{ body: form, method: "POST" },
				);
				transcriptionText = result.text;
			}
			if (!transcriptionText?.trim()) {
				setStatus(t("status.noText"));
				queueMicrotask(() => statusElement.current?.focus());
				return;
			}
			setDocumentText((current) =>
				appendTranscript(current, transcriptionText),
			);
			queueMicrotask(() => documentInput.current?.focus());
			setStatus(
				translationMode
					? t("status.translationAdded")
					: t("status.dictationAdded"),
			);
			void completeScratch()
				.then((recording) =>
					saveToLibrary({
						audio: recording.audio,
						durationSeconds: recording.durationSeconds,
						...(translationMode
							? {
									status: "translated" as const,
									type: "translation" as const,
								}
							: {}),
						text: transcriptionText,
					}),
				)
				.then(async () => {
					await capture.scratch.discard();
					invalidateWorkspace();
				})
				.catch(() => {
					if (!captureRef.current) {
						setStatus(t("status.librarySaveFailed"));
					}
				});
		} catch (error) {
			setStatus(userErrorMessage(error, t));
			queueMicrotask(() => statusElement.current?.focus());
		} finally {
			releaseCapture(capture);
			releaseRecordingLock();
			closeFloatingPanel();
			setCaptureState("idle");
			setElapsed(0);
			setLevel(0);
			setLiveFinalText("");
			setLiveProvisionalText("");
		}
	}, [
		closeFloatingPanel,
		invalidateWorkspace,
		language,
		releaseRecordingLock,
		translationMode,
		translationSourceLanguage,
		translationTargetLanguage,
		t,
	]);

	const startCapture = useCallback(async () => {
		if (captureRef.current || captureState === "sending") return;
		if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
			setStatus(t("status.browserCannotRecord"));
			return;
		}
		let stream: MediaStream | undefined;
		let pipeline: Awaited<ReturnType<typeof createPcmCapture>> | undefined;
		let realtime: WebRealtimeSession | undefined;
		let scratch: ScratchCapture | undefined;
		let fallbackDeviceName: string | undefined;
		try {
			const release = await acquireRecordingLock();
			if (!release) {
				setStatus(t("status.anotherTab"));
				return;
			}
			recordingLockReleaseRef.current = release;
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					audio: audioCaptureConstraints(microphoneDeviceId),
				});
			} catch (error) {
				if (!microphoneDeviceId || !savedMicrophoneUnavailable(error))
					throw error;
				stream = await navigator.mediaDevices.getUserMedia({
					audio: audioCaptureConstraints(null),
				});
				fallbackDeviceName =
					stream.getAudioTracks()[0]?.label || "another available microphone";
			}
			if (!stream) throw new Error(t("status.couldNotStartMicrophone"));
			const activeScratch = await scratchStorage().start();
			scratch = activeScratch;
			const speechPreCheck = createSpeechPreCheckAccumulator();
			const stats = { sampleCount: 0 };
			let recoveryText = "";
			const languageHints = translationMode
				? [translationSourceLanguage]
				: language
						.split(",")
						.map((value) => value.trim())
						.filter(Boolean);
			realtime = startWebRealtime({
				config: {
					audio_format: AUDIO_FORMAT.wireFormat,
					num_channels: AUDIO_FORMAT.channels,
					sample_rate: AUDIO_FORMAT.sampleRate,
					...buildTranscriptionConfig({
						languageHints,
						...(translationMode
							? {
									translation: {
										sourceLanguage: translationSourceLanguage,
										targetLanguage: translationTargetLanguage,
									},
								}
							: {}),
					}),
				},
				onTokens(tokens: readonly RealtimeToken[]) {
					const finalized = tokens
						.filter((token) => token.isFinal)
						.map((token) => token.text)
						.join("");
					if (finalized) {
						recoveryText += finalized;
						activeScratch.setText(recoveryText);
						setLiveFinalText((current) => `${current}${finalized}`);
					}
					setLiveProvisionalText(
						tokens
							.filter((token) => !token.isFinal)
							.map((token) => token.text)
							.join(""),
					);
				},
			});
			pipeline = await createPcmCapture({
				onFrame(frame) {
					speechPreCheck.push(frame);
					activeScratch.appendPcm(frame);
					stats.sampleCount += frame.length;
					realtime?.sendAudio(frame);
					const nextElapsed = Math.floor(
						stats.sampleCount / AUDIO_FORMAT.sampleRate,
					);
					setElapsed((current) =>
						current === nextElapsed ? current : nextElapsed,
					);
				},
				onLevel: setLevel,
				stream,
			});
			const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
				? { mimeType: "audio/webm;codecs=opus" }
				: undefined;
			// ponytail: stream browser WebM/Opus to OPFS; revisit WebCodecs only if profiling shows encoder CPU delaying long meetings (#030).
			const mediaRecorder = new MediaRecorder(
				pipeline.destination.stream,
				options,
			);
			const capture: ActiveCapture = {
				audioContext: pipeline.audioContext,
				mediaWrites: Promise.resolve(),
				mediaRecorder,
				realtime,
				scratch: activeScratch,
				speechPreCheck,
				stats,
				stream,
				worklet: pipeline.worklet,
			};
			mediaRecorder.addEventListener("dataavailable", (event) => {
				if (!event.data.size) return;
				capture.mediaWrites = capture.mediaWrites
					.then(() => activeScratch.appendEncoded(event.data))
					.catch(() => undefined);
			});
			captureRef.current = capture;
			mediaRecorder.start(250);
			setCaptureState("recording");
			setElapsed(0);
			setStatus(
				fallbackDeviceName
					? t("status.microphoneFallback", { device: fallbackDeviceName })
					: t("status.listening"),
			);
			if (stopHoldWhenReadyRef.current) {
				stopHoldWhenReadyRef.current = false;
				void finishCapture();
			}
		} catch (error) {
			realtime?.close();
			pipeline?.worklet.disconnect();
			for (const track of stream?.getTracks() ?? []) track.stop();
			void pipeline?.audioContext.close();
			await scratch?.discard().catch(() => undefined);
			stopHoldWhenReadyRef.current = false;
			releaseRecordingLock();
			setStatus(t("status.couldNotStartMicrophone"));
		}
	}, [
		captureState,
		finishCapture,
		language,
		microphoneDeviceId,
		releaseRecordingLock,
		scratchStorage,
		translationMode,
		translationSourceLanguage,
		translationTargetLanguage,
		t,
	]);

	useEffect(() => {
		const onShortcut = (event: KeyboardEvent) => {
			if (event.key === "Escape" && isCommandPaletteOpen) {
				event.preventDefault();
				closeCommandPalette();
				return;
			}
			if (matchesCommandPaletteShortcut(event)) {
				event.preventDefault();
				if (!isCommandPaletteOpen) openCommandPalette();
				return;
			}
			if (isCommandPaletteOpen) return;
			if (event.key === "Escape" && captureRef.current) {
				event.preventDefault();
				void cancelCapture();
				return;
			}
			if (
				event.repeat ||
				!matchesDictationShortcut(event, dictationShortcut) ||
				isEditableTarget(event.target)
			)
				return;
			event.preventDefault();
			if (captureRef.current) void finishCapture();
			else void startCapture();
		};
		window.addEventListener("keydown", onShortcut);
		return () => window.removeEventListener("keydown", onShortcut);
	}, [
		cancelCapture,
		closeCommandPalette,
		dictationShortcut,
		finishCapture,
		isCommandPaletteOpen,
		openCommandPalette,
		startCapture,
	]);

	function toggleCapture() {
		void (isRecording ? finishCapture() : startCapture());
	}

	function startHoldCapture(event: ReactPointerEvent<HTMLButtonElement>) {
		if (event.button !== 0 || captureRef.current || captureState !== "idle")
			return;
		holdCaptureRef.current = true;
		void startCapture();
	}

	const stopHoldCapture = useCallback(() => {
		if (!holdCaptureRef.current) return;
		holdCaptureRef.current = false;
		if (captureRef.current) {
			void finishCapture();
		} else {
			stopHoldWhenReadyRef.current = true;
		}
	}, [finishCapture]);

	useEffect(() => {
		window.addEventListener("pointercancel", stopHoldCapture);
		window.addEventListener("pointerup", stopHoldCapture);
		return () => {
			window.removeEventListener("pointercancel", stopHoldCapture);
			window.removeEventListener("pointerup", stopHoldCapture);
		};
	}, [stopHoldCapture]);

	useEffect(
		() => () => {
			void cancelCapture();
		},
		[cancelCapture],
	);

	async function sendOtp(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!isValidEmail(email)) {
			setStatus(t("errors.requestRejected"));
			return;
		}
		setStatus(t("auth.sendingCode"));
		try {
			await bffJson("/bff/auth/send-otp", {
				body: JSON.stringify({ email }),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
			setAuthState("otp-sent");
			setStatus(t("auth.checkInbox"));
		} catch (error) {
			setStatus(userErrorMessage(error, t));
		}
	}

	async function verifyOtp(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!isValidEmail(email) || !isValidOtp(otp)) {
			setStatus(t("errors.requestRejected"));
			return;
		}
		setStatus(t("auth.signingIn"));
		try {
			await bffJson("/bff/auth/verify-otp", {
				body: JSON.stringify({ email, otp }),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
			await refreshSession();
		} catch (error) {
			setStatus(userErrorMessage(error, t));
		}
	}

	async function signOut() {
		await fetch("/bff/auth/logout", {
			credentials: "same-origin",
			method: "POST",
		});
		setAuthState("signed-out");
		setSignedInEmail("");
		setStatus(t("auth.signedOut"));
	}

	async function copyDocument() {
		try {
			await navigator.clipboard.writeText(documentText);
			setStatus(t("status.copied"));
		} catch {
			setStatus(t("status.clipboardDenied"));
		}
	}

	async function translatePastedText() {
		if (!translationText.trim()) {
			setStatus(t("status.pasteBeforeTranslate"));
			return;
		}
		setStatus(t("status.translatingPasted"));
		try {
			const result = await bffJson<unknown>(
				translationUrl(translationText, {
					sourceLanguage: translationSourceLanguage,
					targetLanguage: translationTargetLanguage,
				}),
			);
			const text = translationResultText(result);
			if (!text) {
				setStatus(t("status.translationNoText"));
				return;
			}
			setTranslationResult(text);
			setStatus(t("status.pastedTranslated"));
		} catch (error) {
			setStatus(userErrorMessage(error, t));
		}
	}

	function completeOnboarding(retention: RetentionPolicy) {
		localStorage.setItem(onboardingCompletedStorageKey, "1");
		if (retention === "never")
			localStorage.setItem(pendingRetentionStorageKey, retention);
		else localStorage.removeItem(pendingRetentionStorageKey);
		setOnboardingOpen(false);
	}

	if (authState === "checking") {
		return <main className="shell">{t("app.checkingSession")}</main>;
	}

	if (onboardingOpen && authState !== "signed-in") {
		return (
			<Onboarding initialStep="microphone" onComplete={completeOnboarding} />
		);
	}

	if (authState !== "signed-in") {
		return (
			<main className="shell auth">
				<h1>{t("app.title")}</h1>
				<p>{t("auth.description")}</p>
				{authState === "otp-sent" ? (
					<form onSubmit={verifyOtp}>
						<label htmlFor="otp">{t("auth.oneTimeCode")}</label>
						<input
							autoComplete="one-time-code"
							id="otp"
							inputMode="numeric"
							onChange={(event) => setOtp(event.target.value)}
							pattern="[0-9]{6}"
							required
							value={otp}
						/>
						<button type="submit">{t("auth.signIn")}</button>
						<button onClick={() => setAuthState("signed-out")} type="button">
							{t("auth.useAnotherEmail")}
						</button>
					</form>
				) : (
					<form onSubmit={sendOtp}>
						<label htmlFor="email">{t("auth.email")}</label>
						<input
							autoComplete="email"
							id="email"
							onChange={(event) => setEmail(event.target.value)}
							required
							type="email"
							value={email}
						/>
						<button type="submit">{t("auth.sendCode")}</button>
					</form>
				)}
				<p aria-live="polite" className="status">
					{status}
				</p>
			</main>
		);
	}

	const isRecording = captureState === "recording";
	return (
		<main className="shell workspace">
			<header>
				<div>
					<h1>{t("app.title")}</h1>
					<p>{signedInEmail}</p>
				</div>
				<div className="workspace-actions">
					<nav aria-label={t("app.workspace")}>
						<button
							aria-current={view === "dictation" ? "page" : undefined}
							onClick={() => setView("dictation")}
							type="button"
						>
							{t("app.nav.dictation")}
						</button>
						<button
							aria-current={view === "library" ? "page" : undefined}
							disabled={captureState !== "idle"}
							onClick={() => setView("library")}
							type="button"
						>
							{t("app.nav.library")}
						</button>
						<button
							aria-current={view === "settings" ? "page" : undefined}
							disabled={captureState !== "idle"}
							onClick={() => setView("settings")}
							type="button"
						>
							{t("app.nav.settings")}
						</button>
					</nav>
					<button
						disabled={captureState !== "idle"}
						onClick={() => setOnboardingOpen(true)}
						ref={onboardingReturnFocus}
						type="button"
					>
						{t("app.nav.aboutDelivery")}
					</button>
					<button onClick={() => void signOut()} type="button">
						{t("app.nav.signOut")}
					</button>
				</div>
			</header>
			{onboardingOpen ? (
				<Onboarding
					asDialog
					initialStep="delivery"
					onClose={() => {
						setOnboardingOpen(false);
						queueMicrotask(() => onboardingReturnFocus.current?.focus());
					}}
					onComplete={completeOnboarding}
				/>
			) : null}
			{isCommandPaletteOpen ? (
				<CommandPalette onClose={closeCommandPalette} onCopied={setStatus} />
			) : null}
			{view === "library" ? (
				<LibraryPane
					onLibraryChanged={broadcastWorkspaceChange}
					revision={workspaceRevision}
				/>
			) : view === "settings" ? (
				<SettingsPane
					onSettingsChanged={invalidateWorkspace}
					revision={workspaceRevision}
				/>
			) : (
				<>
					<label className="language" htmlFor="language">
						{t("dictation.languageHints")}
						<input
							id="language"
							onChange={(event) => setLanguage(event.target.value)}
							value={language}
						/>
					</label>
					<label className="checkbox" htmlFor="translation-mode">
						<input
							checked={translationMode}
							disabled={captureState !== "idle"}
							id="translation-mode"
							onChange={(event) => setTranslationMode(event.target.checked)}
							type="checkbox"
						/>
						{t("dictation.translationMode")}
					</label>
					{translationMode ? (
						<p>
							{t("dictation.translates", {
								source: translationSourceLanguage,
								target: translationTargetLanguage,
							})}
						</p>
					) : null}
					<textarea
						aria-label={t("dictation.document")}
						ref={documentInput}
						onChange={(event) => setDocumentText(event.target.value)}
						placeholder={t("dictation.documentPlaceholder")}
						value={documentText}
					/>
					{captureState !== "idle" && !pictureInPictureContainer ? (
						<LiveTranscriptPanel
							announceLiveTranscript={announceLiveTranscript}
							liveFinalText={liveFinalText}
							liveProvisionalText={liveProvisionalText}
						/>
					) : null}
					{pictureInPictureContainer
						? createPortal(
								<LiveTranscriptPanel
									announceLiveTranscript={announceLiveTranscript}
									liveFinalText={liveFinalText}
									liveProvisionalText={liveProvisionalText}
									onReturnToPage={closeFloatingPanel}
								/>,
								pictureInPictureContainer,
							)
						: null}
					<div className="controls">
						<button
							disabled={captureState === "sending"}
							onClick={toggleCapture}
							type="button"
						>
							{isRecording ? t("dictation.stop") : t("dictation.start")}
						</button>
						<button
							disabled={captureState !== "idle"}
							onPointerCancel={stopHoldCapture}
							onPointerDown={startHoldCapture}
							onPointerUp={stopHoldCapture}
							type="button"
						>
							{t("dictation.hold")}
						</button>
						<button
							disabled={!isRecording}
							onClick={() => void cancelCapture()}
							type="button"
						>
							{t("dictation.cancel")}
						</button>
						{captureState !== "idle" &&
						capabilities.documentPictureInPicture &&
						!pictureInPictureContainer ? (
							<button onClick={() => void openFloatingPanel()} type="button">
								{t("floatingPanel.open")}
							</button>
						) : null}
						<button
							disabled={!documentText}
							onClick={() => void copyDocument()}
							type="button"
						>
							{t("dictation.copy")}
						</button>
					</div>
					<div className="meter-row">
						<div
							aria-label={t("dictation.microphoneLevel")}
							aria-valuemax={100}
							aria-valuemin={0}
							aria-valuenow={Math.round(level * 100)}
							className="meter"
							role="progressbar"
							tabIndex={0}
						>
							<span style={{ transform: `scaleX(${level})` }} />
						</div>
						<output>
							{isRecording
								? t("dictation.meterElapsed", { seconds: elapsed })
								: captureState === "sending"
									? t("dictation.meterSending")
									: t("dictation.meterIdle")}
						</output>
					</div>
					<p className="shortcut">
						{t("dictation.shortcut", { shortcut: dictationShortcut })}
					</p>
					<section
						aria-labelledby="paste-translation-title"
						className="settings-section"
					>
						<h2 id="paste-translation-title">{t("dictation.pasteTitle")}</h2>
						<p>{t("dictation.pasteDescription")}</p>
						<label htmlFor="translation-text">
							{t("dictation.textToTranslate")}
							<textarea
								id="translation-text"
								onChange={(event) => setTranslationText(event.target.value)}
								value={translationText}
							/>
						</label>
						<button
							disabled={!translationText.trim()}
							onClick={() => void translatePastedText()}
							type="button"
						>
							{t("dictation.translatePasted")}
						</button>
						<output aria-label={t("dictation.translationResult")}>
							{translationResult}
						</output>
					</section>
					<p
						aria-live="polite"
						className="status"
						ref={statusElement}
						tabIndex={-1}
					>
						{status}
					</p>
				</>
			)}
		</main>
	);
}
