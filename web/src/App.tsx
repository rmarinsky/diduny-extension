import {
	type FormEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { AUDIO_FORMAT } from "../../src/core/constants";
import { speechPreCheck } from "../../src/core/speech-precheck";
import { LibraryPane } from "./LibraryPane";
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
	matchesDictationShortcut,
} from "./dictation";
import { setUiLocale } from "./i18n";
import { createWorkspaceInvalidationBus } from "./invalidation";
import { saveToLibrary } from "./library";
import { acquireRecordingLock } from "./recording-lock";
import { getWorkspaceSettings } from "./settings";
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
	chunks: Blob[];
	frames: Int16Array[];
	mediaRecorder: MediaRecorder;
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

function errorMessage(body: unknown, fallback: string) {
	if (
		body &&
		typeof body === "object" &&
		"error" in body &&
		typeof body.error === "string"
	) {
		return body.error;
	}
	return fallback;
}

async function bffJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, { credentials: "same-origin", ...init });
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok)
		throw new Error(errorMessage(body, `Request failed (${response.status})`));
	return body as T;
}

function joinFrames(frames: readonly Int16Array[]) {
	const output = new Int16Array(
		frames.reduce((total, frame) => total + frame.length, 0),
	);
	let offset = 0;
	for (const frame of frames) {
		output.set(frame, offset);
		offset += frame.length;
	}
	return output;
}

async function stopRecorder(recorder: MediaRecorder) {
	if (recorder.state === "inactive") return;
	await new Promise<void>((resolve) => {
		recorder.addEventListener("stop", () => resolve(), { once: true });
		recorder.stop();
	});
}

function releaseCapture(capture: ActiveCapture) {
	capture.worklet.disconnect();
	for (const track of capture.stream.getTracks()) track.stop();
	void capture.audioContext.close();
}

export function App() {
	const [capabilities] = useState(detectBrowserCapabilities);
	const missingCapabilities = missingBrowserCapabilities(capabilities);
	if (missingCapabilities.length) {
		return (
			<main className="shell capability-gate">
				<h1>Diduny needs a supported browser</h1>
				<p>
					Use a current Chromium-based browser with the following capabilities:
				</p>
				<ul>
					{missingCapabilities.map((capability) => (
						<li key={capability.key}>
							<strong>{capability.label}</strong> - {capability.reason}
						</li>
					))}
				</ul>
			</main>
		);
	}
	const [authState, setAuthState] = useState<AuthState>("checking");
	const [captureState, setCaptureState] = useState<CaptureState>("idle");
	const [documentText, setDocumentText] = useState("");
	const [dictationShortcut, setDictationShortcut] = useState(DEFAULT_SHORTCUT);
	const [email, setEmail] = useState("");
	const [elapsed, setElapsed] = useState(0);
	const [language, setLanguage] = useState("uk");
	const [level, setLevel] = useState(0);
	const [microphoneDeviceId, setMicrophoneDeviceId] = useState<string | null>(
		null,
	);
	const [otp, setOtp] = useState("");
	const [signedInEmail, setSignedInEmail] = useState("");
	const [status, setStatus] = useState("Checking your session…");
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
	const holdCaptureRef = useRef(false);
	const recordingLockReleaseRef = useRef<(() => void) | null>(null);
	const stopHoldWhenReadyRef = useRef(false);
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

	const refreshSession = useCallback(async () => {
		try {
			const session = await bffJson<SessionResponse>("/bff/auth/session");
			setAuthState(session.authenticated ? "signed-in" : "signed-out");
			setSignedInEmail(session.email ?? "");
			setStatus(
				session.authenticated ? "Ready to dictate." : "Sign in to dictate.",
			);
		} catch {
			setAuthState("signed-out");
			setStatus("Could not reach the Diduny service.");
		}
	}, []);

	useEffect(() => {
		void refreshSession();
	}, [refreshSession]);

	useEffect(() => {
		void workspaceRevision;
		if (authState !== "signed-in") {
			setDictationShortcut(DEFAULT_SHORTCUT);
			setMicrophoneDeviceId(null);
			setTranslationSourceLanguage("uk");
			setTranslationTargetLanguage("en");
			void setUiLocale("en");
			return;
		}
		void getWorkspaceSettings()
			.then(({ settings }) => {
				setDictationShortcut(settings.dictationShortcut);
				setMicrophoneDeviceId(settings.microphoneDeviceId);
				setTranslationSourceLanguage(settings.translationSourceLanguage);
				setTranslationTargetLanguage(settings.translationTargetLanguage);
				void setUiLocale(settings.uiLocale);
			})
			.catch(() => {
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
		} finally {
			releaseCapture(capture);
			releaseRecordingLock();
			setCaptureState("idle");
			setElapsed(0);
			setLevel(0);
			setStatus("Dictation cancelled.");
		}
	}, [releaseRecordingLock]);

	const finishCapture = useCallback(async () => {
		stopHoldWhenReadyRef.current = false;
		const capture = captureRef.current;
		if (!capture) return;
		captureRef.current = null;
		setCaptureState("sending");
		setStatus("Transcribing…");
		try {
			await stopRecorder(capture.mediaRecorder);
			const preCheck = speechPreCheck(joinFrames(capture.frames));
			if (!preCheck.hasSpeech) {
				setStatus("No speech detected. Nothing was sent.");
				return;
			}

			const audio = new Blob(capture.chunks, {
				type: capture.mediaRecorder.mimeType || "audio/webm",
			});
			const form = new FormData();
			form.append("audio", audio, "dictation.webm");
			const languageHints = translationMode
				? [translationSourceLanguage]
				: language
						.split(",")
						.map((value) => value.trim())
						.filter(Boolean);
			form.append(
				"config",
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
			);
			const result = await bffJson<TranscriptionResponse>(
				"/bff/api/transcriptions",
				{ body: form, method: "POST" },
			);
			if (!result.text?.trim()) {
				setStatus("The transcription returned no text.");
				return;
			}
			setDocumentText((current) =>
				appendTranscript(current, result.text ?? ""),
			);
			setStatus(
				translationMode
					? "Translation added to this document."
					: "Dictation added to this document.",
			);
			void saveToLibrary({
				audio,
				durationSeconds: Math.floor(
					capture.stats.sampleCount / AUDIO_FORMAT.sampleRate,
				),
				...(translationMode
					? { status: "translated" as const, type: "translation" as const }
					: {}),
				text: result.text,
			})
				.then(invalidateWorkspace)
				.catch(() => {
					if (!captureRef.current) {
						setStatus(
							"Dictation added. The local library could not save a copy.",
						);
					}
				});
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Dictation failed.");
		} finally {
			releaseCapture(capture);
			releaseRecordingLock();
			setCaptureState("idle");
			setElapsed(0);
			setLevel(0);
		}
	}, [
		invalidateWorkspace,
		language,
		releaseRecordingLock,
		translationMode,
		translationSourceLanguage,
		translationTargetLanguage,
	]);

	const startCapture = useCallback(async () => {
		if (captureRef.current || captureState === "sending") return;
		if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
			setStatus("This browser cannot record audio.");
			return;
		}
		let stream: MediaStream | undefined;
		let pipeline: Awaited<ReturnType<typeof createPcmCapture>> | undefined;
		let fallbackDeviceName: string | undefined;
		try {
			const release = await acquireRecordingLock();
			if (!release) {
				setStatus("Recording is active in another tab.");
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
			if (!stream) throw new Error("Could not start the microphone.");
			const frames: Int16Array[] = [];
			const stats = { sampleCount: 0 };
			pipeline = await createPcmCapture({
				onFrame(frame) {
					frames.push(frame);
					stats.sampleCount += frame.length;
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
			const mediaRecorder = new MediaRecorder(
				pipeline.destination.stream,
				options,
			);
			const chunks: Blob[] = [];
			mediaRecorder.addEventListener("dataavailable", (event) => {
				if (event.data.size) chunks.push(event.data);
			});
			const capture: ActiveCapture = {
				audioContext: pipeline.audioContext,
				chunks,
				frames,
				mediaRecorder,
				stats,
				stream,
				worklet: pipeline.worklet,
			};
			captureRef.current = capture;
			mediaRecorder.start(250);
			setCaptureState("recording");
			setElapsed(0);
			setStatus(
				fallbackDeviceName
					? `Saved microphone is unavailable. Recording with ${fallbackDeviceName}.`
					: "Listening…",
			);
			if (stopHoldWhenReadyRef.current) {
				stopHoldWhenReadyRef.current = false;
				void finishCapture();
			}
		} catch (error) {
			pipeline?.worklet.disconnect();
			for (const track of stream?.getTracks() ?? []) track.stop();
			void pipeline?.audioContext.close();
			stopHoldWhenReadyRef.current = false;
			releaseRecordingLock();
			setStatus(
				error instanceof Error
					? error.message
					: "Could not start the microphone.",
			);
		}
	}, [captureState, finishCapture, microphoneDeviceId, releaseRecordingLock]);

	useEffect(() => {
		const onShortcut = (event: KeyboardEvent) => {
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
	}, [cancelCapture, dictationShortcut, finishCapture, startCapture]);

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
		setStatus("Sending a one-time code…");
		try {
			await bffJson("/bff/auth/send-otp", {
				body: JSON.stringify({ email }),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
			setAuthState("otp-sent");
			setStatus("Check your inbox for the six-digit code.");
		} catch (error) {
			setStatus(
				error instanceof Error ? error.message : "Could not send the code.",
			);
		}
	}

	async function verifyOtp(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setStatus("Signing in…");
		try {
			await bffJson("/bff/auth/verify-otp", {
				body: JSON.stringify({ email, otp }),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
			await refreshSession();
		} catch (error) {
			setStatus(
				error instanceof Error ? error.message : "Could not verify the code.",
			);
		}
	}

	async function signOut() {
		await fetch("/bff/auth/logout", {
			credentials: "same-origin",
			method: "POST",
		});
		setAuthState("signed-out");
		setSignedInEmail("");
		setStatus("Signed out.");
	}

	async function copyDocument() {
		try {
			await navigator.clipboard.writeText(documentText);
			setStatus("Copied to clipboard.");
		} catch {
			setStatus("The browser did not allow clipboard access.");
		}
	}

	async function translatePastedText() {
		if (!translationText.trim()) {
			setStatus("Paste text before translating it.");
			return;
		}
		setStatus("Translating pasted text…");
		try {
			const result = await bffJson<unknown>(
				translationUrl(translationText, {
					sourceLanguage: translationSourceLanguage,
					targetLanguage: translationTargetLanguage,
				}),
			);
			const text = translationResultText(result);
			if (!text) {
				setStatus(
					"The translation returned no text. Check the language pair and try again.",
				);
				return;
			}
			setTranslationResult(text);
			setStatus("Pasted text translated.");
		} catch (error) {
			setStatus(
				error instanceof Error
					? error.message
					: "Could not translate the pasted text. Check the Diduny service and try again.",
			);
		}
	}

	if (authState === "checking") {
		return <main className="shell">Checking your session…</main>;
	}

	if (authState !== "signed-in") {
		return (
			<main className="shell auth">
				<h1>Diduny</h1>
				<p>
					Sign in here once to make this browser available to the extension.
				</p>
				{authState === "otp-sent" ? (
					<form onSubmit={verifyOtp}>
						<label htmlFor="otp">One-time code</label>
						<input
							autoComplete="one-time-code"
							id="otp"
							inputMode="numeric"
							onChange={(event) => setOtp(event.target.value)}
							pattern="[0-9]{6}"
							required
							value={otp}
						/>
						<button type="submit">Sign in</button>
						<button onClick={() => setAuthState("signed-out")} type="button">
							Use another email
						</button>
					</form>
				) : (
					<form onSubmit={sendOtp}>
						<label htmlFor="email">Email</label>
						<input
							autoComplete="email"
							id="email"
							onChange={(event) => setEmail(event.target.value)}
							required
							type="email"
							value={email}
						/>
						<button type="submit">Send one-time code</button>
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
					<h1>Diduny</h1>
					<p>{signedInEmail}</p>
				</div>
				<div className="workspace-actions">
					<nav aria-label="Workspace">
						<button
							aria-current={view === "dictation" ? "page" : undefined}
							onClick={() => setView("dictation")}
							type="button"
						>
							Dictation
						</button>
						<button
							aria-current={view === "library" ? "page" : undefined}
							disabled={captureState !== "idle"}
							onClick={() => setView("library")}
							type="button"
						>
							Library
						</button>
						<button
							aria-current={view === "settings" ? "page" : undefined}
							disabled={captureState !== "idle"}
							onClick={() => setView("settings")}
							type="button"
						>
							Settings
						</button>
					</nav>
					<button onClick={() => void signOut()} type="button">
						Sign out
					</button>
				</div>
			</header>
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
						Language hints
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
						Translation dictation
					</label>
					{translationMode ? (
						<p>
							Translates {translationSourceLanguage} to{" "}
							{translationTargetLanguage}.
						</p>
					) : null}
					<textarea
						aria-label="Dictation document"
						onChange={(event) => setDocumentText(event.target.value)}
						placeholder="Your dictation appears here. You can edit it while you work."
						value={documentText}
					/>
					<div className="controls">
						<button
							disabled={captureState === "sending"}
							onClick={toggleCapture}
							type="button"
						>
							{isRecording ? "Stop dictation" : "Start dictation"}
						</button>
						<button
							disabled={captureState !== "idle"}
							onPointerCancel={stopHoldCapture}
							onPointerDown={startHoldCapture}
							onPointerUp={stopHoldCapture}
							type="button"
						>
							Hold to record
						</button>
						<button
							disabled={!isRecording}
							onClick={() => void cancelCapture()}
							type="button"
						>
							Cancel
						</button>
						<button
							disabled={!documentText}
							onClick={() => void copyDocument()}
							type="button"
						>
							Copy
						</button>
					</div>
					<div className="meter-row">
						<div
							aria-label="Microphone level"
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
								? `${elapsed}s`
								: captureState === "sending"
									? "Sending"
									: "Idle"}
						</output>
					</div>
					<p className="shortcut">
						Shortcut: {dictationShortcut} outside text fields.
					</p>
					<section
						aria-labelledby="paste-translation-title"
						className="settings-section"
					>
						<h2 id="paste-translation-title">Paste-in translation</h2>
						<p>
							Paste text into Diduny to translate it. Other applications are not
							read.
						</p>
						<label htmlFor="translation-text">
							Text to translate
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
							Translate pasted text
						</button>
						<output aria-label="Translation result">{translationResult}</output>
					</section>
					<p aria-live="polite" className="status">
						{status}
					</p>
				</>
			)}
		</main>
	);
}
