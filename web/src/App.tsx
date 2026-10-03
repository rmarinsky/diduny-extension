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
import {
	isValidEmail,
	isValidOtp,
	normalizeEmail,
	normalizeOtp,
} from "../../src/core/auth-validation";
import {
	AUDIO_FORMAT,
	TRANSCRIPTION_UPLOAD_TIMEOUT,
	WEB_LATENCY_TARGET_MS,
} from "../../src/core/constants";
import type { RealtimeToken } from "../../src/core/realtime-session";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import { createSpeechPreCheckAccumulator } from "../../src/core/speech-precheck";
import { CommandPalette } from "./CommandPalette";
import { ConfirmDialog } from "./ConfirmDialog";
import { LibraryPane } from "./LibraryPane";
import {
	AboutDelivery,
	StartPage,
	onboardingCompletedStorageKey,
} from "./Onboarding";
import { SettingsPane } from "./SettingsPane";
import { AppBar, ThemeToggle } from "./ThemeToggle";
import { TranslationLanguages } from "./TranslationLanguages";
import {
	audioCaptureConstraints,
	microphoneStartFailureKey,
	savedMicrophoneUnavailable,
} from "./audio-devices";
import {
	detectBrowserCapabilities,
	missingBrowserCapabilities,
} from "./capabilities";
import { createPcmCapture } from "./capture";
import {
	DEFAULT_SHORTCUT,
	EXTENSION_DICTATION_EVENT,
	appendTranscript,
	firesInTextFields,
	isEditableTarget,
	matchesCommandPaletteShortcut,
	matchesDictationShortcut,
} from "./dictation";
import {
	errorFromResponse,
	isIncorrectOtpError,
	isInvalidEmailError,
	localProcessUnavailable,
	pastedTranslationErrorMessage,
	userErrorMessage,
} from "./errors";
import i18n, { setUiLocale, supportedUiLocales } from "./i18n";
import { createWorkspaceInvalidationBus } from "./invalidation";
import { dictationLanguages, ownLanguageName } from "./languages";
import { saveToLibrary } from "./library";
import {
	type PendingChoices,
	parsePendingChoices,
	pendingChoicesStorageKey,
	pendingSettingsChanges,
} from "./onboarding-choices";
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
import {
	getWorkspaceSettings,
	updateRetentionPolicy,
	updateWorkspaceSettings,
} from "./settings";
import {
	displayShortcut,
	parseShortcut,
	shortcutPlatform,
} from "./shortcut-editor";
import type { TranslationPair } from "./translation";
import {
	buildTranscriptionConfig,
	translationChunks,
	translationResultText,
	translationUrl,
} from "./translation";
import "./style.css";

type AuthState = "checking" | "otp-sent" | "signed-in" | "signed-out";
type CaptureState = "idle" | "recording" | "sending";
type WorkspaceView = "about" | "dictation" | "library" | "settings";

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

const draftStorageKey = "diduny.dictation.document";

/** The document survives a reload and Back/Forward in this tab. */
function readDraft() {
	try {
		return sessionStorage.getItem(draftStorageKey) ?? "";
	} catch {
		return "";
	}
}

function saveDraft(text: string) {
	try {
		if (text) sessionStorage.setItem(draftStorageKey, text);
		else sessionStorage.removeItem(draftStorageKey);
	} catch {
		// Storage can be unavailable (private mode, quota); the document stays in memory.
	}
}

/** Each view has a history entry, so browser Back and Forward move between views. */
function viewFromLocation(): WorkspaceView {
	const view = window.location.hash.replace(/^#/, "");
	return view === "about" || view === "library" || view === "settings"
		? view
		: "dictation";
}

function viewUrl(view: WorkspaceView) {
	return view === "dictation"
		? `${window.location.pathname}${window.location.search}`
		: `#${view}`;
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
	const [confirmingSignOut, setConfirmingSignOut] = useState(false);
	const [documentText, setDocumentText] = useState(readDraft);
	const [dictationShortcut, setDictationShortcut] = useState(DEFAULT_SHORTCUT);
	const [email, setEmail] = useState("");
	const [emailError, setEmailError] = useState("");
	const [elapsed, setElapsed] = useState(0);
	const [holding, setHolding] = useState(false);
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
	const [otpError, setOtpError] = useState("");
	const [pasteMessage, setPasteMessage] = useState<{
		failed: boolean;
		text: string;
	} | null>(null);
	const [pasteOpen, setPasteOpen] = useState(false);
	const [settingsLoaded, setSettingsLoaded] = useState(false);
	const [signedInEmail, setSignedInEmail] = useState("");
	const [speechLanguageHints, setSpeechLanguageHints] = useState<
		readonly string[]
	>(DEFAULT_SETTINGS.speechLanguageHints);
	const [status, setStatus] = useState(() => t("app.checkingSession"));
	const [translationMode, setTranslationMode] = useState(false);
	const [translationResult, setTranslationResult] = useState("");
	const [translationSourceLanguage, setTranslationSourceLanguage] =
		useState("uk");
	const [translationTargetLanguage, setTranslationTargetLanguage] =
		useState("en");
	const [translationText, setTranslationText] = useState("");
	const [translating, setTranslating] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [view, setView] = useState<WorkspaceView>(viewFromLocation);
	const [workspaceRevision, setWorkspaceRevision] = useState(0);
	const busyRef = useRef(false);
	const captureRef = useRef<ActiveCapture | null>(null);
	const controlsRef = useRef<HTMLDivElement>(null);
	const documentInput = useRef<HTMLTextAreaElement>(null);
	const emailInput = useRef<HTMLInputElement>(null);
	const focusEmailAfterSignOut = useRef(false);
	const pasteRequest = useRef(0);
	const uploadRef = useRef<AbortController | null>(null);
	const holdCaptureRef = useRef(false);
	const aboutReturnFocus = useRef<HTMLButtonElement>(null);
	const paletteReturnFocus = useRef<HTMLElement | null>(null);
	const signOutReturnFocus = useRef<HTMLButtonElement>(null);
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

	useEffect(() => saveDraft(documentText), [documentText]);

	useEffect(() => {
		busyRef.current = captureState !== "idle";
	}, [captureState]);

	useEffect(() => {
		const onPopState = () => {
			// Switching views while recording or transcribing would hide it, as the nav buttons do; stay on Dictation.
			if (busyRef.current) {
				window.history.pushState(null, "", viewUrl("dictation"));
				return;
			}
			setView(viewFromLocation());
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	useEffect(() => {
		if (authState !== "signed-out" || !focusEmailAfterSignOut.current) return;
		focusEmailAfterSignOut.current = false;
		emailInput.current?.focus();
	}, [authState]);

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
		const pending = parsePendingChoices(
			localStorage.getItem(pendingChoicesStorageKey),
		);
		if (Object.keys(pending).length === 0) return;
		void getWorkspaceSettings()
			.then(({ retention: current }) => {
				const { retention, settings } = pendingSettingsChanges(
					pending,
					current.dictation,
				);
				return Promise.all([
					retention ? updateRetentionPolicy("dictation", retention) : undefined,
					Object.keys(settings).length > 0
						? updateWorkspaceSettings(settings)
						: undefined,
				]);
			})
			.then(() => {
				localStorage.removeItem(pendingChoicesStorageKey);
				invalidateWorkspace();
			})
			.catch(() => {
				// Keep the choices for the next authenticated session.
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
		// "Ready to dictate." was set before the saved interface language arrived; say it again in that language.
		const retranslateIdleStatus = () =>
			setStatus((current) => {
				for (const key of ["status.ready", "status.signIn"]) {
					const spoken = supportedUiLocales.some(
						(locale) => i18n.t(key, { lng: locale }) === current,
					);
					if (spoken) return i18n.t(key);
				}
				return current;
			});
		if (authState !== "signed-in") {
			setSettingsLoaded(false);
			setAnnounceLiveTranscript(false);
			setDictationShortcut(DEFAULT_SHORTCUT);
			setMicrophoneDeviceId(null);
			setSpeechLanguageHints(DEFAULT_SETTINGS.speechLanguageHints);
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
				setSpeechLanguageHints(settings.speechLanguageHints);
				setTranslationSourceLanguage(settings.translationSourceLanguage);
				setTranslationTargetLanguage(settings.translationTargetLanguage);
				setSettingsLoaded(true);
				void setUiLocale(settings.uiLocale).then(retranslateIdleStatus);
			})
			.catch(() => {
				setAnnounceLiveTranscript(false);
				setDictationShortcut(DEFAULT_SHORTCUT);
				setMicrophoneDeviceId(null);
				setSpeechLanguageHints(DEFAULT_SETTINGS.speechLanguageHints);
				setTranslationSourceLanguage("uk");
				setTranslationTargetLanguage("en");
				setSettingsLoaded(true);
				void setUiLocale("en").then(retranslateIdleStatus);
			});
	}, [authState, workspaceRevision]);

	const cancelCapture = useCallback(async () => {
		holdCaptureRef.current = false;
		stopHoldWhenReadyRef.current = false;
		setHolding(false);
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
		// Stop (or Hold) is disabled while transcribing, which would drop focus to the page; keep typing in the document.
		const focused = document.activeElement;
		const input = documentInput.current;
		if (
			input &&
			(!focused ||
				focused === document.body ||
				controlsRef.current?.contains(focused))
		) {
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
		}
		let upload: AbortController | undefined;
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
					: speechLanguageHints;
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
				// Without a time limit a request that never answers would leave every control disabled.
				upload = new AbortController();
				const activeUpload = upload;
				uploadRef.current = activeUpload;
				setUploading(true);
				const timeout = window.setTimeout(
					() => activeUpload.abort("timeout"),
					TRANSCRIPTION_UPLOAD_TIMEOUT.baseMs +
						recording.durationSeconds *
							TRANSCRIPTION_UPLOAD_TIMEOUT.perRecordedSecondMs,
				);
				try {
					const result = await bffJson<TranscriptionResponse>(
						"/bff/api/transcriptions",
						{ body: form, method: "POST", signal: activeUpload.signal },
					);
					transcriptionText = result.text;
				} finally {
					window.clearTimeout(timeout);
					uploadRef.current = null;
					setUploading(false);
				}
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
			if (upload?.signal.reason === "cancel") {
				await capture.scratch.discard().catch(() => undefined);
				setStatus(t("status.transcriptionCancelled"));
				return;
			}
			setStatus(
				upload?.signal.reason === "timeout"
					? t("status.transcriptionTimedOut")
					: userErrorMessage(error, t),
			);
			queueMicrotask(() => statusElement.current?.focus());
		} finally {
			releaseCapture(capture);
			releaseRecordingLock();
			closeFloatingPanel();
			setCaptureState("idle");
			setElapsed(0);
			setHolding(false);
			setLevel(0);
			setLiveFinalText("");
			setLiveProvisionalText("");
		}
	}, [
		closeFloatingPanel,
		invalidateWorkspace,
		releaseRecordingLock,
		speechLanguageHints,
		translationMode,
		translationSourceLanguage,
		translationTargetLanguage,
		t,
	]);

	/** Escape or Cancel while the completed recording is being transcribed. */
	const cancelTranscription = useCallback(() => {
		uploadRef.current?.abort("cancel");
	}, []);

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
		// The browser's reason the microphone did not open, so the message can say what to do.
		let microphoneError: unknown;
		const openMicrophone = (deviceId: string | null) =>
			navigator.mediaDevices
				.getUserMedia({ audio: audioCaptureConstraints(deviceId) })
				.then(
					(opened) => {
						microphoneError = undefined;
						return opened;
					},
					(error: unknown) => {
						microphoneError = error;
						throw error;
					},
				);
		try {
			const release = await acquireRecordingLock();
			if (!release) {
				setStatus(t("status.anotherTab"));
				return;
			}
			recordingLockReleaseRef.current = release;
			try {
				stream = await openMicrophone(microphoneDeviceId);
			} catch (error) {
				if (!microphoneDeviceId || !savedMicrophoneUnavailable(error))
					throw error;
				stream = await openMicrophone(null);
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
				: speechLanguageHints;
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
			holdCaptureRef.current = false;
			stopHoldWhenReadyRef.current = false;
			setHolding(false);
			releaseRecordingLock();
			setStatus(
				t(
					microphoneError
						? microphoneStartFailureKey(microphoneError)
						: "status.couldNotStartMicrophone",
				),
			);
		}
	}, [
		captureState,
		finishCapture,
		microphoneDeviceId,
		releaseRecordingLock,
		scratchStorage,
		speechLanguageHints,
		translationMode,
		translationSourceLanguage,
		translationTargetLanguage,
		t,
	]);

	useEffect(() => {
		const toggleFromShortcut = () => {
			if (captureRef.current) void finishCapture();
			else void startCapture();
		};
		const onShortcut = (event: KeyboardEvent) => {
			if (confirmingSignOut) return;
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
			if (event.key === "Escape" && uploadRef.current) {
				event.preventDefault();
				cancelTranscription();
				return;
			}
			if (
				event.repeat ||
				!matchesDictationShortcut(event, dictationShortcut) ||
				(isEditableTarget(event.target) &&
					!firesInTextFields(dictationShortcut))
			)
				return;
			event.preventDefault();
			toggleFromShortcut();
		};
		const onExtensionShortcut = () => {
			if (confirmingSignOut || isCommandPaletteOpen) return;
			toggleFromShortcut();
		};
		window.addEventListener("keydown", onShortcut);
		window.addEventListener(EXTENSION_DICTATION_EVENT, onExtensionShortcut);
		return () => {
			window.removeEventListener("keydown", onShortcut);
			window.removeEventListener(
				EXTENSION_DICTATION_EVENT,
				onExtensionShortcut,
			);
		};
	}, [
		cancelCapture,
		cancelTranscription,
		closeCommandPalette,
		confirmingSignOut,
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
		setHolding(true);
		void startCapture();
	}

	const stopHoldCapture = useCallback(() => {
		if (!holdCaptureRef.current) return;
		holdCaptureRef.current = false;
		setHolding(false);
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

	function clearSignInFields() {
		setEmail("");
		setEmailError("");
		setOtp("");
		setOtpError("");
	}

	async function sendOtp(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const address = normalizeEmail(email);
		if (!isValidEmail(address)) {
			setEmailError(t("auth.invalidEmail"));
			setStatus("");
			return;
		}
		setEmail(address);
		setEmailError("");
		setStatus(t("auth.sendingCode"));
		try {
			await bffJson("/bff/auth/send-otp", {
				body: JSON.stringify({ email: address }),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
			setOtp("");
			setOtpError("");
			setAuthState("otp-sent");
			setStatus(t("auth.checkInbox"));
		} catch (error) {
			if (isInvalidEmailError(error)) {
				setEmailError(t("auth.invalidEmail"));
				setStatus("");
				return;
			}
			setStatus(userErrorMessage(error, t));
		}
	}

	async function verifyOtp(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const code = normalizeOtp(otp);
		if (!isValidOtp(code)) {
			setOtpError(t("auth.invalidCode"));
			setStatus("");
			return;
		}
		setOtp(code);
		setOtpError("");
		if (!isValidEmail(email)) {
			setStatus(t("errors.requestRejected"));
			return;
		}
		setStatus(t("auth.signingIn"));
		try {
			await bffJson("/bff/auth/verify-otp", {
				body: JSON.stringify({ email, otp: code }),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
			clearSignInFields();
			await refreshSession();
		} catch (error) {
			if (isIncorrectOtpError(error)) {
				setOtpError(t("auth.incorrectCode"));
				setStatus("");
				return;
			}
			setStatus(userErrorMessage(error, t));
		}
	}

	function chooseAnotherEmail() {
		clearSignInFields();
		setAuthState("signed-out");
		setStatus(t("status.signIn"));
	}

	async function signOut() {
		setConfirmingSignOut(false);
		await fetch("/bff/auth/logout", {
			credentials: "same-origin",
			method: "POST",
		});
		clearSignInFields();
		window.history.replaceState(null, "", viewUrl("dictation"));
		setView("dictation");
		focusEmailAfterSignOut.current = true;
		setAuthState("signed-out");
		setSignedInEmail("");
		setStatus(t("auth.signedOut"));
	}

	function showView(next: WorkspaceView) {
		if (next === view) return;
		window.history.pushState(null, "", viewUrl(next));
		setView(next);
	}

	function cancelSignOut() {
		setConfirmingSignOut(false);
		queueMicrotask(() => signOutReturnFocus.current?.focus());
	}

	function closeAboutDelivery() {
		showView("dictation");
		queueMicrotask(() => aboutReturnFocus.current?.focus());
	}

	async function changeTranslationLanguages(pair: TranslationPair) {
		const previous = {
			sourceLanguage: translationSourceLanguage,
			targetLanguage: translationTargetLanguage,
		};
		setTranslationSourceLanguage(pair.sourceLanguage);
		setTranslationTargetLanguage(pair.targetLanguage);
		try {
			const settings = await updateWorkspaceSettings({
				translationSourceLanguage: pair.sourceLanguage,
				translationTargetLanguage: pair.targetLanguage,
			});
			setTranslationSourceLanguage(settings.translationSourceLanguage);
			setTranslationTargetLanguage(settings.translationTargetLanguage);
			broadcastWorkspaceChange();
		} catch (error) {
			setTranslationSourceLanguage(previous.sourceLanguage);
			setTranslationTargetLanguage(previous.targetLanguage);
			setStatus(userErrorMessage(error, t));
		}
	}

	async function toggleLanguageHint(code: string, checked: boolean) {
		const previous = speechLanguageHints;
		const others = previous.filter((language) => language !== code);
		const next = checked ? [...others, code] : others;
		setSpeechLanguageHints(next);
		try {
			const settings = await updateWorkspaceSettings({
				speechLanguageHints: next,
			});
			setSpeechLanguageHints(settings.speechLanguageHints);
			broadcastWorkspaceChange();
		} catch (error) {
			setSpeechLanguageHints(previous);
			setStatus(userErrorMessage(error, t));
		}
	}

	async function copyDocument() {
		try {
			await navigator.clipboard.writeText(documentText);
			setStatus(t("status.copied"));
		} catch {
			setStatus(t("status.clipboardDenied"));
		}
	}

	function clearDocument() {
		const input = documentInput.current;
		input?.focus();
		input?.select();
		// Deleting through the browser's editing command keeps its undo history, so Ctrl+Z brings the text back.
		if (!input || !document.execCommand("delete")) setDocumentText("");
		setStatus(t("status.documentCleared"));
	}

	async function translatePastedText() {
		if (!translationText.trim()) {
			setPasteMessage({ failed: true, text: t("status.pasteBeforeTranslate") });
			return;
		}
		const request = ++pasteRequest.current;
		const pair = {
			sourceLanguage: translationSourceLanguage,
			targetLanguage: translationTargetLanguage,
		};
		// The old result must not pass for the translation of the new text.
		setTranslationResult("");
		setTranslating(true);
		setPasteMessage({ failed: false, text: t("status.translatingPasted") });
		try {
			// Long text goes in parts: each request carries its text in the URL.
			let translated = "";
			for (const chunk of translationChunks(translationText)) {
				const result = await bffJson<unknown>(translationUrl(chunk.text, pair));
				if (request !== pasteRequest.current) return;
				translated += translationResultText(result) + chunk.gap;
			}
			setTranslationResult(translated.trim());
			setPasteMessage({ failed: false, text: t("status.pastedTranslated") });
		} catch (error) {
			if (request !== pasteRequest.current) return;
			setPasteMessage({
				failed: true,
				text: pastedTranslationErrorMessage(error, t),
			});
		} finally {
			if (request === pasteRequest.current) setTranslating(false);
		}
	}

	function completeOnboarding(choices: PendingChoices) {
		localStorage.setItem(onboardingCompletedStorageKey, "1");
		if (Object.keys(choices).length > 0)
			localStorage.setItem(pendingChoicesStorageKey, JSON.stringify(choices));
		else localStorage.removeItem(pendingChoicesStorageKey);
		setOnboardingOpen(false);
	}

	if (authState === "checking") {
		return <main className="shell">{t("app.checkingSession")}</main>;
	}

	if (onboardingOpen && authState !== "signed-in") {
		return (
			<StartPage
				initialChoices={parsePendingChoices(
					localStorage.getItem(pendingChoicesStorageKey),
				)}
				onContinue={completeOnboarding}
			/>
		);
	}

	if (authState !== "signed-in") {
		return (
			<main className="shell auth">
				<AppBar />
				<p>{t("auth.description")}</p>
				{/* Keys stop React reusing the "Use another email" button as the email form submit mid-click, which submitted an empty address. */}
				{authState === "otp-sent" ? (
					// noValidate: a malformed or refused code is explained inline below the field, not in a browser tooltip.
					<form key="otp" noValidate onSubmit={verifyOtp}>
						<label htmlFor="otp">{t("auth.oneTimeCode")}</label>
						<input
							aria-describedby={otpError ? "otp-error" : undefined}
							aria-invalid={otpError ? true : undefined}
							autoComplete="one-time-code"
							id="otp"
							inputMode="numeric"
							onChange={(event) => {
								setOtp(event.target.value);
								setOtpError("");
							}}
							pattern="[0-9]{6}"
							required
							value={otp}
						/>
						{otpError ? (
							<p className="field-error" id="otp-error">
								{otpError}
							</p>
						) : null}
						<button type="submit">{t("auth.signIn")}</button>
						<button
							className="secondary"
							onClick={chooseAnotherEmail}
							type="button"
						>
							{t("auth.useAnotherEmail")}
						</button>
					</form>
				) : (
					// noValidate: the browser's type=email rule refuses international addresses; isValidEmail decides.
					<form key="email" noValidate onSubmit={sendOtp}>
						<label htmlFor="email">{t("auth.email")}</label>
						<input
							aria-describedby={emailError ? "email-error" : undefined}
							aria-invalid={emailError ? true : undefined}
							autoCapitalize="off"
							autoComplete="email"
							id="email"
							inputMode="email"
							onChange={(event) => {
								setEmail(event.target.value);
								setEmailError("");
							}}
							ref={emailInput}
							required
							spellCheck={false}
							type="text"
							value={email}
						/>
						{emailError ? (
							<p className="field-error" id="email-error">
								{emailError}
							</p>
						) : null}
						<button type="submit">{t("auth.sendCode")}</button>
					</form>
				)}
				<p aria-live="polite" className="status">
					{status}
				</p>
				<button
					className="secondary"
					onClick={() => setOnboardingOpen(true)}
					type="button"
				>
					{t("app.nav.aboutDelivery")}
				</button>
			</main>
		);
	}

	const isRecording = captureState === "recording";
	const translationPair = {
		sourceLanguage: translationSourceLanguage,
		targetLanguage: translationTargetLanguage,
	};
	return (
		<main className="shell workspace">
			<header>
				<div className="brand-block">
					<h1>
						<button
							className="brand"
							onClick={() => showView("dictation")}
							type="button"
						>
							{t("app.title")}
						</button>
					</h1>
					<p className="account">{signedInEmail}</p>
				</div>
				<div className="workspace-actions">
					<nav aria-label={t("app.workspace")}>
						<button
							aria-current={view === "dictation" ? "page" : undefined}
							onClick={() => showView("dictation")}
							type="button"
						>
							{t("app.nav.dictation")}
						</button>
						<button
							aria-current={view === "library" ? "page" : undefined}
							disabled={captureState !== "idle"}
							onClick={() => showView("library")}
							type="button"
						>
							{t("app.nav.library")}
						</button>
						<button
							aria-current={view === "settings" ? "page" : undefined}
							disabled={captureState !== "idle"}
							onClick={() => showView("settings")}
							type="button"
						>
							{t("app.nav.settings")}
						</button>
					</nav>
					<button
						aria-current={view === "about" ? "page" : undefined}
						disabled={captureState !== "idle"}
						onClick={() => showView("about")}
						ref={aboutReturnFocus}
						type="button"
					>
						{t("app.nav.aboutDelivery")}
					</button>
					<button
						disabled={captureState !== "idle"}
						onClick={() => setConfirmingSignOut(true)}
						ref={signOutReturnFocus}
						type="button"
					>
						{t("app.nav.signOut")}
					</button>
					<ThemeToggle />
				</div>
			</header>
			{confirmingSignOut ? (
				<ConfirmDialog
					body={t("auth.signOutConfirm.body")}
					cancelLabel={t("auth.signOutConfirm.cancel")}
					confirmLabel={t("auth.signOutConfirm.confirm")}
					onCancel={cancelSignOut}
					onConfirm={() => void signOut()}
					title={t("auth.signOutConfirm.title")}
				/>
			) : null}
			{isCommandPaletteOpen ? (
				<CommandPalette onClose={closeCommandPalette} onCopied={setStatus} />
			) : null}
			{view === "about" ? (
				<AboutDelivery
					onBack={closeAboutDelivery}
					onSettingsChanged={invalidateWorkspace}
				/>
			) : view === "library" ? (
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
				<div className="dictation">
					<fieldset
						aria-describedby="language-hints-hint"
						className="language-hints"
						disabled={captureState !== "idle" || translationMode}
					>
						<legend>{t("dictation.languages")}</legend>
						{dictationLanguages.map((code) => (
							<label
								className="checkbox pill"
								htmlFor={`language-hint-${code}`}
								key={code}
							>
								<input
									checked={speechLanguageHints.includes(code)}
									id={`language-hint-${code}`}
									onChange={(event) =>
										void toggleLanguageHint(code, event.target.checked)
									}
									type="checkbox"
								/>
								<span lang={code}>{ownLanguageName(code)}</span>
							</label>
						))}
						<p className="hint" id="language-hints-hint">
							{translationMode
								? t("dictation.languagesInTranslation", {
										source: ownLanguageName(translationSourceLanguage),
									})
								: t("dictation.languagesHint")}
						</p>
					</fieldset>
					<div className="translation-row">
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
						<TranslationLanguages
							disabled={captureState !== "idle"}
							idPrefix="dictation-translation"
							label={t("dictation.translationLanguages")}
							onChange={(pair) => void changeTranslationLanguages(pair)}
							pair={translationPair}
						/>
					</div>
					<textarea
						aria-label={t("dictation.document")}
						className="document"
						ref={documentInput}
						onChange={(event) => setDocumentText(event.target.value)}
						placeholder={t("dictation.documentPlaceholder")}
						value={documentText}
					/>
					{/* While a hold is active only its button stays visible; the others keep their space so it never moves. */}
					<div
						className={holding ? "controls holding" : "controls"}
						ref={controlsRef}
					>
						{/* Both labels share one cell, so switching to "Stop" never resizes the button and shifts the hold button. */}
						<button
							className="toggle"
							disabled={captureState === "sending"}
							onClick={toggleCapture}
							type="button"
						>
							<span aria-hidden={isRecording}>{t("dictation.start")}</span>
							<span aria-hidden={!isRecording}>{t("dictation.stop")}</span>
						</button>
						<button
							aria-pressed={holding}
							className="hold"
							disabled={captureState !== "idle" && !holding}
							onContextMenu={(event) => event.preventDefault()}
							onPointerCancel={stopHoldCapture}
							onPointerDown={startHoldCapture}
							onPointerUp={stopHoldCapture}
							type="button"
						>
							{t("dictation.hold")}
						</button>
						<button
							disabled={!isRecording && !uploading}
							onClick={() =>
								isRecording ? void cancelCapture() : cancelTranscription()
							}
							type="button"
						>
							{t("dictation.cancel")}
						</button>
						{captureState !== "idle" &&
						!holding &&
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
						<button
							className="secondary"
							disabled={!documentText}
							onClick={clearDocument}
							type="button"
						>
							{t("dictation.clear")}
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
						<p
							aria-live="polite"
							className="status"
							ref={statusElement}
							tabIndex={-1}
						>
							{status}
						</p>
						{/* Until the saved settings arrive the shortcut is unknown; showing the default would be wrong. */}
						<p className="shortcut">
							{settingsLoaded
								? t(
										firesInTextFields(dictationShortcut)
											? "dictation.shortcut"
											: "dictation.shortcutOutsideFields",
										{
											shortcut: displayShortcut(
												parseShortcut(dictationShortcut),
												shortcutPlatform(),
											),
										},
									)
								: null}
						</p>
					</div>
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
					<details
						className="paste-translation"
						onToggle={(event) => setPasteOpen(event.currentTarget.open)}
						open={pasteOpen}
					>
						<summary>{t("dictation.pasteTitle")}</summary>
						<div className="paste-body">
							<p className="hint">{t("dictation.pasteDescription")}</p>
							<TranslationLanguages
								disabled={captureState !== "idle"}
								idPrefix="paste-translation"
								label={t("dictation.pasteLanguages")}
								onChange={(pair) => void changeTranslationLanguages(pair)}
								pair={translationPair}
							/>
							<label htmlFor="translation-text">
								{t("dictation.textToTranslate")}
								<textarea
									id="translation-text"
									onChange={(event) => setTranslationText(event.target.value)}
									value={translationText}
								/>
							</label>
							<button
								disabled={!translationText.trim() || translating}
								onClick={() => void translatePastedText()}
								type="button"
							>
								{t("dictation.translatePasted")}
							</button>
							<p
								aria-live="polite"
								className={
									pasteMessage?.failed ? "status field-error" : "status"
								}
							>
								{pasteMessage?.text}
							</p>
							<output
								aria-label={t("dictation.translationResult")}
								className="translation-result"
							>
								{translationResult}
							</output>
						</div>
					</details>
				</div>
			)}
		</main>
	);
}
