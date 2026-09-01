import {
	type FormEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
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
import {
	DEFAULT_SHORTCUT,
	appendTranscript,
	isEditableTarget,
	matchesDictationShortcut,
} from "./dictation";
import { createWorkspaceInvalidationBus } from "./invalidation";
import { saveToLibrary } from "./library";
import { acquireRecordingLock } from "./recording-lock";
import { getWorkspaceSettings } from "./settings";
import "./style.css";

type AuthState = "checking" | "otp-sent" | "signed-in" | "signed-out";
type CaptureState = "idle" | "recording" | "sending";
type WorkspaceView = "dictation" | "library" | "settings";

interface ActiveCapture {
	audioContext: AudioContext;
	analyser: AnalyserNode;
	chunks: Blob[];
	frames: Float32Array[];
	mediaRecorder: MediaRecorder;
	renderFrame: number;
	startedAt: number;
	stream: MediaStream;
	timer: number;
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

function joinFrames(frames: readonly Float32Array[]) {
	const output = new Float32Array(
		frames.reduce((total, frame) => total + frame.length, 0),
	);
	let offset = 0;
	for (const frame of frames) {
		output.set(frame, offset);
		offset += frame.length;
	}
	return output;
}

function elapsedSeconds(startedAt: number) {
	return Math.floor((Date.now() - startedAt) / 1000);
}

async function stopRecorder(recorder: MediaRecorder) {
	if (recorder.state === "inactive") return;
	await new Promise<void>((resolve) => {
		recorder.addEventListener("stop", () => resolve(), { once: true });
		recorder.stop();
	});
}

function releaseCapture(capture: ActiveCapture) {
	window.clearInterval(capture.timer);
	window.cancelAnimationFrame(capture.renderFrame);
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
	const [view, setView] = useState<WorkspaceView>("dictation");
	const [workspaceRevision, setWorkspaceRevision] = useState(0);
	const captureRef = useRef<ActiveCapture | null>(null);
	const holdCaptureRef = useRef(false);
	const recordingLockReleaseRef = useRef<(() => void) | null>(null);
	const suppressHoldClickRef = useRef(false);
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
			setMicrophoneDeviceId(null);
			return;
		}
		void getWorkspaceSettings()
			.then(({ settings }) =>
				setMicrophoneDeviceId(settings.microphoneDeviceId),
			)
			.catch(() => setMicrophoneDeviceId(null));
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
			form.append(
				"config",
				JSON.stringify({
					enable_speaker_diarization: false,
					language_hints: language
						.split(",")
						.map((value) => value.trim())
						.filter(Boolean),
					mode: "transcribe",
				}),
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
			setStatus("Dictation added to this document.");
			void saveToLibrary({
				audio,
				durationSeconds: elapsedSeconds(capture.startedAt),
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
	}, [invalidateWorkspace, language, releaseRecordingLock]);

	const startCapture = useCallback(async () => {
		if (captureRef.current || captureState === "sending") return;
		if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
			setStatus("This browser cannot record audio.");
			return;
		}
		let stream: MediaStream | undefined;
		let audioContext: AudioContext | undefined;
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
			audioContext = new AudioContext({ sampleRate: 16_000 });
			await audioContext.resume();
			const source = audioContext.createMediaStreamSource(stream);
			const analyser = audioContext.createAnalyser();
			analyser.fftSize = 1024;
			const destination = audioContext.createMediaStreamDestination();
			source.connect(analyser);
			source.connect(destination);

			const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
				? { mimeType: "audio/webm;codecs=opus" }
				: undefined;
			const mediaRecorder = new MediaRecorder(destination.stream, options);
			const chunks: Blob[] = [];
			const frames: Float32Array[] = [];
			mediaRecorder.addEventListener("dataavailable", (event) => {
				if (event.data.size) chunks.push(event.data);
			});
			const startedAt = Date.now();
			const renderLevel = () => {
				const frame = new Float32Array(analyser.fftSize);
				analyser.getFloatTimeDomainData(frame);
				frames.push(frame);
				let sum = 0;
				for (const sample of frame) sum += sample * sample;
				setLevel(Math.min(1, Math.sqrt(sum / frame.length) * 8));
				const active = captureRef.current;
				if (active)
					active.renderFrame = window.requestAnimationFrame(renderLevel);
			};
			const capture: ActiveCapture = {
				audioContext,
				analyser,
				chunks,
				frames,
				mediaRecorder,
				renderFrame: 0,
				startedAt,
				stream,
				timer: 0,
			};
			captureRef.current = capture;
			capture.timer = window.setInterval(
				() => setElapsed(elapsedSeconds(startedAt)),
				250,
			);
			capture.renderFrame = window.requestAnimationFrame(renderLevel);
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
			for (const track of stream?.getTracks() ?? []) track.stop();
			void audioContext?.close();
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
				!matchesDictationShortcut(event) ||
				isEditableTarget(event.target)
			)
				return;
			event.preventDefault();
			if (captureRef.current) void finishCapture();
			else void startCapture();
		};
		window.addEventListener("keydown", onShortcut);
		return () => window.removeEventListener("keydown", onShortcut);
	}, [cancelCapture, finishCapture, startCapture]);

	function toggleCapture() {
		if (suppressHoldClickRef.current) {
			suppressHoldClickRef.current = false;
			return;
		}
		void (isRecording ? finishCapture() : startCapture());
	}

	function startHoldCapture(event: ReactPointerEvent<HTMLButtonElement>) {
		if (event.button !== 0 || captureRef.current || captureState !== "idle")
			return;
		holdCaptureRef.current = true;
		suppressHoldClickRef.current = true;
		void startCapture();
	}

	function stopHoldCapture() {
		if (!holdCaptureRef.current) return;
		holdCaptureRef.current = false;
		if (captureRef.current) {
			void finishCapture();
		} else {
			stopHoldWhenReadyRef.current = true;
		}
	}

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
							onPointerCancel={stopHoldCapture}
							onPointerDown={startHoldCapture}
							onPointerUp={stopHoldCapture}
							onMouseUp={stopHoldCapture}
							type="button"
						>
							{isRecording ? "Stop dictation" : "Start dictation"}
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
						Shortcut: {DEFAULT_SHORTCUT} outside text fields.
					</p>
					<p aria-live="polite" className="status">
						{status}
					</p>
				</>
			)}
		</main>
	);
}
