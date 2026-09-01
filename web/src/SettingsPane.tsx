import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { wordCount } from "../../src/core/models";
import type { RetentionCategory, RetentionPolicy } from "../../src/core/ports";
import type { Settings } from "../../src/core/settings";
import {
	isReservedShortcut,
	normalizeShortcut,
} from "../../src/core/shortcuts";
import {
	audioInputDevices,
	microphonePermissionFailure,
	resolveAudioInput,
} from "./audio-devices";
import {
	type WorkspaceSettingsSnapshot,
	getWorkspaceSettings,
	updateRetentionPolicy,
	updateWorkspaceSettings,
} from "./settings";

const retentionOptions: ReadonlyArray<{
	label: string;
	value: RetentionPolicy;
}> = [
	{ label: "Never save", value: "never" },
	{ label: "7 days", value: "days7" },
	{ label: "30 days", value: "days30" },
	{ label: "90 days", value: "days90" },
	{ label: "1 year", value: "year1" },
	{ label: "Keep forever", value: "forever" },
];

const calibrationText = "Clear ideas deserve calm words and careful attention.";

function terms(value: string) {
	return value
		.split("\n")
		.map((item) => item.trim())
		.filter(Boolean);
}

function formatBytes(value: number) {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let amount = value;
	let unit = 0;
	while (amount >= 1024 && unit < units.length - 1) {
		amount /= 1024;
		unit += 1;
	}
	return `${amount.toLocaleString(undefined, {
		maximumFractionDigits: unit === 0 ? 0 : 1,
	})} ${units[unit]}`;
}

function formatDuration(value: number) {
	const seconds = Math.abs(Math.round(value));
	const minutes = Math.floor(seconds / 60);
	return minutes
		? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
		: `${seconds}s`;
}

function errorMessage(error: unknown) {
	return error instanceof Error
		? error.message
		: "Could not save this setting. Check the local Diduny service and try again.";
}

type MicrophoneAccess =
	| "checking"
	| "denied"
	| "granted"
	| "prompt"
	| "unsupported";

function MicrophoneSettings({
	onSave,
	savedDeviceId,
}: {
	onSave(deviceId: string | null): Promise<void>;
	savedDeviceId: string | null;
}) {
	const [access, setAccess] = useState<MicrophoneAccess>("checking");
	const [devices, setDevices] = useState<ReturnType<typeof audioInputDevices>>(
		[],
	);
	const [message, setMessage] = useState("");
	const { device, savedDeviceMissing } = resolveAudioInput(
		devices,
		savedDeviceId,
	);

	const inspect = useCallback(async () => {
		if (!navigator.mediaDevices?.enumerateDevices) {
			setAccess("unsupported");
			return;
		}
		try {
			const permission = navigator.permissions?.query
				? await navigator.permissions.query({
						name: "microphone" as PermissionName,
					})
				: null;
			if (permission?.state === "denied") {
				setAccess("denied");
				setDevices([]);
				return;
			}
			if (permission?.state !== "granted") {
				setAccess("prompt");
				setDevices([]);
				return;
			}
			setAccess("granted");
			setDevices(
				audioInputDevices(await navigator.mediaDevices.enumerateDevices()),
			);
		} catch {
			setAccess("prompt");
			setDevices([]);
		}
	}, []);

	useEffect(() => {
		void inspect();
	}, [inspect]);

	async function requestPermission() {
		if (!navigator.mediaDevices?.getUserMedia) {
			setAccess("unsupported");
			return;
		}
		setMessage("Requesting microphone permission…");
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			for (const track of stream.getTracks()) track.stop();
			setAccess("granted");
			setDevices(
				audioInputDevices(await navigator.mediaDevices.enumerateDevices()),
			);
			setMessage("Microphone permission granted.");
		} catch (error) {
			setAccess(
				microphonePermissionFailure(error) === "denied" ? "denied" : "prompt",
			);
			setMessage(errorMessage(error));
		}
	}

	async function saveDevice(value: string) {
		try {
			await onSave(value || null);
			setMessage("Microphone preference saved.");
		} catch (error) {
			setMessage(errorMessage(error));
		}
	}

	return (
		<section aria-labelledby="microphone-title" className="settings-section">
			<h3 id="microphone-title">Microphone</h3>
			{access === "checking" ? <p>Checking microphone permission…</p> : null}
			{access === "prompt" ? (
				<>
					<p>Microphone permission is required before devices can be named.</p>
					<button onClick={() => void requestPermission()} type="button">
						Allow microphone
					</button>
				</>
			) : null}
			{access === "denied" ? (
				<p role="alert">
					Microphone access is blocked. Open this site’s settings in your
					browser, allow Microphone, then return here and refresh.
				</p>
			) : null}
			{access === "unsupported" ? (
				<p role="alert">This browser cannot enumerate microphone devices.</p>
			) : null}
			{access === "granted" && devices.length === 0 ? (
				<p role="alert">No microphone is available to this browser.</p>
			) : null}
			{access === "granted" && devices.length ? (
				<>
					<label htmlFor="microphone-device">
						Recording microphone
						<select
							id="microphone-device"
							onChange={(event) => void saveDevice(event.target.value)}
							value={device?.deviceId ?? ""}
						>
							<option value="">Browser default microphone</option>
							{devices.map((input) => (
								<option key={input.deviceId} value={input.deviceId}>
									{input.label}
								</option>
							))}
						</select>
					</label>
					{savedDeviceMissing ? (
						<p role="alert">
							Saved microphone is unavailable. The browser will use{" "}
							{device?.label}.
						</p>
					) : null}
				</>
			) : null}
			<button onClick={() => void inspect()} type="button">
				Refresh microphone devices
			</button>
			<p aria-live="polite" className="status">
				{message}
			</p>
		</section>
	);
}

export function SettingsPane({
	onSettingsChanged,
	revision,
}: {
	onSettingsChanged(): void;
	revision: number;
}) {
	const [snapshot, setSnapshot] = useState<WorkspaceSettingsSnapshot | null>(
		null,
	);
	const [cleanupEnabled, setCleanupEnabled] = useState(false);
	const [dictationShortcut, setDictationShortcut] = useState("");
	const [fillerWords, setFillerWords] = useState("");
	const [lexicon, setLexicon] = useState("");
	const [message, setMessage] = useState("");
	const [typingStartedAt, setTypingStartedAt] = useState<number | null>(null);
	const [typingText, setTypingText] = useState("");
	const typingInput = useRef<HTMLTextAreaElement>(null);

	const refresh = useCallback(async () => {
		try {
			const next = await getWorkspaceSettings();
			setSnapshot(next);
			setCleanupEnabled(next.settings.textCleanupEnabled);
			setDictationShortcut(next.settings.dictationShortcut);
			setFillerWords(next.settings.fillerWords.join("\n"));
			setLexicon(next.settings.protectedLexicon.join("\n"));
		} catch (error) {
			setMessage(errorMessage(error));
		}
	}, []);

	useEffect(() => {
		void revision;
		void refresh();
	}, [refresh, revision]);

	useEffect(() => {
		if (typingStartedAt !== null) typingInput.current?.focus();
	}, [typingStartedAt]);

	async function saveCleanup(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		try {
			const settings = await updateWorkspaceSettings({
				fillerWords: terms(fillerWords),
				protectedLexicon: terms(lexicon),
				textCleanupEnabled: cleanupEnabled,
			});
			setSnapshot((current) => (current ? { ...current, settings } : current));
			setMessage(
				"Cleanup settings saved. New library views and copies use this text.",
			);
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error));
		}
	}

	async function saveRetention(
		category: RetentionCategory,
		policy: RetentionPolicy,
	) {
		try {
			const retention = await updateRetentionPolicy(category, policy);
			setSnapshot((current) => (current ? { ...current, retention } : current));
			setMessage("Retention policy saved.");
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error));
		}
	}

	async function saveMicrophone(deviceId: string | null) {
		try {
			const settings = await updateWorkspaceSettings({
				microphoneDeviceId: deviceId,
			});
			setSnapshot((current) => (current ? { ...current, settings } : current));
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error));
			throw error;
		}
	}

	async function saveShortcut(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const shortcut = normalizeShortcut(dictationShortcut);
		if (!shortcut) {
			setMessage("Use one key, optionally with Ctrl, Alt, Shift, or Meta.");
			return;
		}
		if (isReservedShortcut(shortcut)) {
			setMessage(`${shortcut} is reserved by this browser and cannot be used.`);
			return;
		}
		try {
			const settings = await updateWorkspaceSettings({
				dictationShortcut: shortcut,
			});
			setDictationShortcut(settings.dictationShortcut);
			setSnapshot((current) => (current ? { ...current, settings } : current));
			setMessage(`Shortcut saved: ${settings.dictationShortcut}.`);
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error));
		}
	}

	function startTypingTest() {
		setTypingText("");
		setTypingStartedAt(performance.now());
		setMessage("Type the sentence, then save your measured speed.");
	}

	async function finishTypingTest() {
		if (typingStartedAt === null) return;
		const words = wordCount(typingText);
		const elapsedSeconds = (performance.now() - typingStartedAt) / 1_000;
		if (!words || elapsedSeconds <= 0) {
			setMessage("Type at least one word before saving your measured speed.");
			return;
		}
		try {
			const settings = await updateWorkspaceSettings({
				typingSpeedWordsPerMinute: (words * 60) / elapsedSeconds,
			});
			setSnapshot((current) => (current ? { ...current, settings } : current));
			setTypingStartedAt(null);
			await refresh();
			onSettingsChanged();
			setMessage("Typing speed measured and saved.");
		} catch (error) {
			setMessage(errorMessage(error));
		}
	}

	if (!snapshot) {
		return <p aria-live="polite">Loading settings…</p>;
	}

	const { settings, stats, storage } = snapshot;
	return (
		<section aria-labelledby="settings-title" className="settings">
			<header>
				<h2 id="settings-title">Settings</h2>
				<button onClick={() => void refresh()} type="button">
					Refresh data
				</button>
			</header>

			<section aria-labelledby="cleanup-title" className="settings-section">
				<h3 id="cleanup-title">Transcript cleanup</h3>
				<form onSubmit={saveCleanup}>
					<label className="checkbox" htmlFor="cleanup-enabled">
						<input
							checked={cleanupEnabled}
							id="cleanup-enabled"
							onChange={(event) => setCleanupEnabled(event.target.checked)}
							type="checkbox"
						/>
						Enable filler-word cleanup
					</label>
					<label htmlFor="filler-words">
						Filler words, one per line
						<textarea
							id="filler-words"
							onChange={(event) => setFillerWords(event.target.value)}
							value={fillerWords}
						/>
					</label>
					<label htmlFor="protected-lexicon">
						Protected terms, one per line
						<textarea
							id="protected-lexicon"
							onChange={(event) => setLexicon(event.target.value)}
							value={lexicon}
						/>
					</label>
					<button type="submit">Save cleanup</button>
				</form>
			</section>

			<MicrophoneSettings
				onSave={saveMicrophone}
				savedDeviceId={settings.microphoneDeviceId}
			/>

			<section aria-labelledby="shortcut-title" className="settings-section">
				<h3 id="shortcut-title">Keyboard shortcut</h3>
				<form onSubmit={saveShortcut}>
					<label htmlFor="dictation-shortcut">
						Toggle dictation
						<input
							aria-describedby="dictation-shortcut-help"
							id="dictation-shortcut"
							onChange={(event) => setDictationShortcut(event.target.value)}
							value={dictationShortcut}
						/>
					</label>
					<p id="dictation-shortcut-help">
						Use one key, optionally with Ctrl, Alt, Shift, or Meta.
						Browser-reserved chords are refused.
					</p>
					<button type="submit">Save shortcut</button>
				</form>
			</section>

			<section aria-labelledby="retention-title" className="settings-section">
				<h3 id="retention-title">Retention</h3>
				<p>
					“Never save” writes neither a library row nor an audio file after
					capture.
				</p>
				{(["dictation", "meeting"] as const).map((category) => (
					<label key={category} htmlFor={`retention-${category}`}>
						{category === "dictation"
							? "Dictation and translation"
							: "Meetings"}
						<select
							id={`retention-${category}`}
							onChange={(event) =>
								void saveRetention(
									category,
									event.target.value as RetentionPolicy,
								)
							}
							value={snapshot.retention[category]}
						>
							{retentionOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
				))}
			</section>

			<section aria-labelledby="statistics-title" className="settings-section">
				<h3 id="statistics-title">Dictation statistics</h3>
				<p>{stats.recordingCount} recordings in this library.</p>
				<p>{stats.wordCount} visible dictation words.</p>
				<p>{formatDuration(stats.dictationDurationSeconds)} dictated.</p>
				<p>
					{stats.timeSavedSeconds === null
						? "Time saved needs your measured typing speed."
						: `${formatDuration(Math.abs(stats.timeSavedSeconds))} ${
								stats.timeSavedSeconds >= 0 ? "saved" : "slower than typing"
							}`}
				</p>
				{settings.typingSpeedWordsPerMinute === null ? null : (
					<p>
						Measured speed: {Math.round(settings.typingSpeedWordsPerMinute)}{" "}
						words per minute.
					</p>
				)}
				<p>Type this sentence at your normal pace:</p>
				<blockquote>{calibrationText}</blockquote>
				{typingStartedAt === null ? (
					<button onClick={startTypingTest} type="button">
						Start typing test
					</button>
				) : (
					<>
						<label htmlFor="typing-test-text">
							Typing test text
							<textarea
								id="typing-test-text"
								onChange={(event) => setTypingText(event.target.value)}
								ref={typingInput}
								value={typingText}
							/>
						</label>
						<button onClick={() => void finishTypingTest()} type="button">
							Save measured speed
						</button>
					</>
				)}
			</section>

			<section aria-labelledby="storage-title" className="settings-section">
				<h3 id="storage-title">Storage on this device</h3>
				<p>Data directory: {storage.dataDir}</p>
				<p>Diduny uses {formatBytes(storage.usedBytes)} on disk.</p>
				<p>{formatBytes(storage.freeBytes)} free on this filesystem.</p>
				<a href="/bff/library/export">Download library export</a>
			</section>

			<p aria-live="polite" className="status">
				{message}
			</p>
		</section>
	);
}
