import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
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
	type UiLocale,
	default as i18n,
	languageName,
	setUiLocale,
	supportedUiLocales,
} from "./i18n";
import {
	type WorkspaceSettingsSnapshot,
	getWorkspaceSettings,
	updateRetentionPolicy,
	updateWorkspaceSettings,
} from "./settings";

const retentionOptions: ReadonlyArray<{
	labelKey: string;
	value: RetentionPolicy;
}> = [
	{ labelKey: "settings.retention.never", value: "never" },
	{ labelKey: "settings.retention.days7", value: "days7" },
	{ labelKey: "settings.retention.days30", value: "days30" },
	{ labelKey: "settings.retention.days90", value: "days90" },
	{ labelKey: "settings.retention.year1", value: "year1" },
	{ labelKey: "settings.retention.forever", value: "forever" },
];

const translationLanguages = ["en", "uk"] as const;

function ownLanguageName(code: (typeof translationLanguages)[number]) {
	return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
}

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
	return error instanceof Error ? error.message : i18n.t("settings.saveFailed");
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
	const { t } = useTranslation();
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
		setMessage(t("microphone.requesting"));
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			for (const track of stream.getTracks()) track.stop();
			setAccess("granted");
			setDevices(
				audioInputDevices(await navigator.mediaDevices.enumerateDevices()),
			);
			setMessage(t("microphone.granted"));
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
			setMessage(t("microphone.preferenceSaved"));
		} catch (error) {
			setMessage(errorMessage(error));
		}
	}

	return (
		<section aria-labelledby="microphone-title" className="settings-section">
			<h3 id="microphone-title">{t("microphone.title")}</h3>
			{access === "checking" ? <p>{t("microphone.checking")}</p> : null}
			{access === "prompt" ? (
				<>
					<p>{t("microphone.permissionRequired")}</p>
					<button onClick={() => void requestPermission()} type="button">
						{t("microphone.allow")}
					</button>
				</>
			) : null}
			{access === "denied" ? (
				<p role="alert">{t("microphone.blocked")}</p>
			) : null}
			{access === "unsupported" ? (
				<p role="alert">{t("microphone.unsupported")}</p>
			) : null}
			{access === "granted" && devices.length === 0 ? (
				<p role="alert">{t("microphone.noneAvailable")}</p>
			) : null}
			{access === "granted" && devices.length ? (
				<>
					<label htmlFor="microphone-device">
						{t("microphone.recordingMicrophone")}
						<select
							id="microphone-device"
							onChange={(event) => void saveDevice(event.target.value)}
							value={device?.deviceId ?? ""}
						>
							<option value="">{t("microphone.browserDefault")}</option>
							{devices.map((input) => (
								<option key={input.deviceId} value={input.deviceId}>
									{input.label}
								</option>
							))}
						</select>
					</label>
					{savedDeviceMissing ? (
						<p role="alert">
							{t("microphone.savedUnavailable", { device: device?.label })}
						</p>
					) : null}
				</>
			) : null}
			<button onClick={() => void inspect()} type="button">
				{t("microphone.refresh")}
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
	const { t } = useTranslation();
	const [snapshot, setSnapshot] = useState<WorkspaceSettingsSnapshot | null>(
		null,
	);
	const [announceLiveTranscript, setAnnounceLiveTranscript] = useState(false);
	const [cleanupEnabled, setCleanupEnabled] = useState(false);
	const [dictationShortcut, setDictationShortcut] = useState("");
	const [fillerWords, setFillerWords] = useState("");
	const [lexicon, setLexicon] = useState("");
	const [message, setMessage] = useState("");
	const [uiLocale, setUiLocaleState] = useState<UiLocale>("en");
	const [translationSourceLanguage, setTranslationSourceLanguage] =
		useState("uk");
	const [translationTargetLanguage, setTranslationTargetLanguage] =
		useState("en");
	const [typingStartedAt, setTypingStartedAt] = useState<number | null>(null);
	const [typingText, setTypingText] = useState("");
	const typingInput = useRef<HTMLTextAreaElement>(null);

	const refresh = useCallback(async () => {
		try {
			const next = await getWorkspaceSettings();
			setSnapshot(next);
			setAnnounceLiveTranscript(next.settings.announceLiveTranscript);
			setCleanupEnabled(next.settings.textCleanupEnabled);
			setDictationShortcut(next.settings.dictationShortcut);
			setFillerWords(next.settings.fillerWords.join("\n"));
			setLexicon(next.settings.protectedLexicon.join("\n"));
			setUiLocaleState(next.settings.uiLocale);
			setTranslationSourceLanguage(next.settings.translationSourceLanguage);
			setTranslationTargetLanguage(next.settings.translationTargetLanguage);
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
			setMessage(t("settings.cleanupSaved"));
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
			setMessage(t("settings.retentionSaved"));
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
			setMessage(t("settings.invalidShortcut"));
			return;
		}
		if (isReservedShortcut(shortcut)) {
			setMessage(t("settings.reservedShortcut", { shortcut }));
			return;
		}
		try {
			const settings = await updateWorkspaceSettings({
				dictationShortcut: shortcut,
			});
			setDictationShortcut(settings.dictationShortcut);
			setSnapshot((current) => (current ? { ...current, settings } : current));
			setMessage(
				t("settings.shortcutSaved", { shortcut: settings.dictationShortcut }),
			);
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error));
		}
	}

	async function saveTranslationLanguages(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		try {
			const settings = await updateWorkspaceSettings({
				translationSourceLanguage,
				translationTargetLanguage,
			});
			setSnapshot((current) => (current ? { ...current, settings } : current));
			setTranslationSourceLanguage(settings.translationSourceLanguage);
			setTranslationTargetLanguage(settings.translationTargetLanguage);
			setMessage(t("settings.translationSaved"));
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error));
		}
	}

	async function saveUiLocale(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		try {
			const settings = await updateWorkspaceSettings({ uiLocale });
			setSnapshot((current) => (current ? { ...current, settings } : current));
			setUiLocaleState(settings.uiLocale);
			await setUiLocale(settings.uiLocale);
			setMessage(t("settings.interfaceLanguageSaved"));
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error));
		}
	}

	async function saveAccessibility(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		try {
			const settings = await updateWorkspaceSettings({
				announceLiveTranscript,
			});
			setSnapshot((current) => (current ? { ...current, settings } : current));
			setAnnounceLiveTranscript(settings.announceLiveTranscript);
			setMessage(t("settings.accessibilitySaved"));
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error));
		}
	}

	function startTypingTest() {
		setTypingText("");
		setTypingStartedAt(performance.now());
		setMessage(t("settings.typingStart"));
	}

	async function finishTypingTest() {
		if (typingStartedAt === null) return;
		const words = wordCount(typingText);
		const elapsedSeconds = (performance.now() - typingStartedAt) / 1_000;
		if (!words || elapsedSeconds <= 0) {
			setMessage(t("settings.typingNeedsWords"));
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
			setMessage(t("settings.typingSaved"));
		} catch (error) {
			setMessage(errorMessage(error));
		}
	}

	if (!snapshot) {
		return <p aria-live="polite">{t("settings.loading")}</p>;
	}

	const { settings, stats, storage } = snapshot;
	return (
		<section aria-labelledby="settings-title" className="settings">
			<header>
				<h2 id="settings-title">{t("settings.title")}</h2>
				<button onClick={() => void refresh()} type="button">
					{t("settings.refresh")}
				</button>
			</header>

			<section aria-labelledby="cleanup-title" className="settings-section">
				<h3 id="cleanup-title">{t("settings.cleanupTitle")}</h3>
				<form onSubmit={saveCleanup}>
					<label className="checkbox" htmlFor="cleanup-enabled">
						<input
							checked={cleanupEnabled}
							id="cleanup-enabled"
							onChange={(event) => setCleanupEnabled(event.target.checked)}
							type="checkbox"
						/>
						{t("settings.enableCleanup")}
					</label>
					<label htmlFor="filler-words">
						{t("settings.fillerWords")}
						<textarea
							id="filler-words"
							onChange={(event) => setFillerWords(event.target.value)}
							value={fillerWords}
						/>
					</label>
					<label htmlFor="protected-lexicon">
						{t("settings.protectedLexicon")}
						<textarea
							id="protected-lexicon"
							onChange={(event) => setLexicon(event.target.value)}
							value={lexicon}
						/>
					</label>
					<button type="submit">{t("settings.saveCleanup")}</button>
				</form>
			</section>

			<section
				aria-labelledby="interface-language-title"
				className="settings-section"
			>
				<h3 id="interface-language-title">{t("settings.interfaceLanguage")}</h3>
				<form onSubmit={saveUiLocale}>
					<label htmlFor="ui-locale">
						{t("settings.interfaceLanguage")}
						<select
							id="ui-locale"
							onChange={(event) =>
								setUiLocaleState(event.target.value as UiLocale)
							}
							value={uiLocale}
						>
							{supportedUiLocales.map((locale) => (
								<option key={locale} value={locale}>
									{languageName(locale, locale)}
								</option>
							))}
						</select>
					</label>
					<button type="submit">{t("settings.saveInterfaceLanguage")}</button>
				</form>
			</section>

			<section
				aria-labelledby="accessibility-title"
				className="settings-section"
			>
				<h3 id="accessibility-title">{t("settings.accessibilityTitle")}</h3>
				<form onSubmit={saveAccessibility}>
					<label className="checkbox" htmlFor="announce-live-transcript">
						<input
							checked={announceLiveTranscript}
							id="announce-live-transcript"
							onChange={(event) =>
								setAnnounceLiveTranscript(event.target.checked)
							}
							type="checkbox"
						/>
						{t("settings.announceLive")}
					</label>
					<p>{t("settings.announceLiveDescription")}</p>
					<button type="submit">{t("settings.saveAccessibility")}</button>
				</form>
			</section>

			<MicrophoneSettings
				onSave={saveMicrophone}
				savedDeviceId={settings.microphoneDeviceId}
			/>

			<section aria-labelledby="shortcut-title" className="settings-section">
				<h3 id="shortcut-title">{t("settings.shortcutTitle")}</h3>
				<form onSubmit={saveShortcut}>
					<label htmlFor="dictation-shortcut">
						{t("settings.toggleDictation")}
						<input
							aria-describedby="dictation-shortcut-help"
							id="dictation-shortcut"
							onChange={(event) => setDictationShortcut(event.target.value)}
							value={dictationShortcut}
						/>
					</label>
					<p id="dictation-shortcut-help">{t("settings.shortcutHelp")}</p>
					<button type="submit">{t("settings.saveShortcut")}</button>
				</form>
			</section>

			<section
				aria-labelledby="translation-languages-title"
				className="settings-section"
			>
				<h3 id="translation-languages-title">
					{t("settings.translationLanguages")}
				</h3>
				<form onSubmit={saveTranslationLanguages}>
					<label htmlFor="translation-source-language">
						{t("settings.translationSource")}
						<select
							id="translation-source-language"
							onChange={(event) =>
								setTranslationSourceLanguage(event.target.value)
							}
							value={translationSourceLanguage}
						>
							{translationLanguages.map((language) => (
								<option key={language} value={language}>
									{ownLanguageName(language)}
								</option>
							))}
						</select>
					</label>
					<label htmlFor="translation-target-language">
						{t("settings.translationTarget")}
						<select
							id="translation-target-language"
							onChange={(event) =>
								setTranslationTargetLanguage(event.target.value)
							}
							value={translationTargetLanguage}
						>
							{translationLanguages.map((language) => (
								<option key={language} value={language}>
									{ownLanguageName(language)}
								</option>
							))}
						</select>
					</label>
					<button type="submit">{t("settings.saveTranslation")}</button>
				</form>
			</section>

			<section aria-labelledby="retention-title" className="settings-section">
				<h3 id="retention-title">{t("settings.retentionTitle")}</h3>
				<p>{t("settings.neverSaveDescription")}</p>
				{(["dictation", "meeting"] as const).map((category) => (
					<label key={category} htmlFor={`retention-${category}`}>
						{category === "dictation"
							? t("settings.dictationAndTranslation")
							: t("settings.meetings")}
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
									{t(option.labelKey)}
								</option>
							))}
						</select>
					</label>
				))}
			</section>

			<section aria-labelledby="statistics-title" className="settings-section">
				<h3 id="statistics-title">{t("settings.statisticsTitle")}</h3>
				<p>{t("statistics.recordings", { count: stats.recordingCount })}</p>
				<p>{t("settings.visibleWords", { count: stats.wordCount })}</p>
				<p>
					{t("settings.dictated", {
						duration: formatDuration(stats.dictationDurationSeconds),
					})}
				</p>
				<p>
					{stats.timeSavedSeconds === null
						? t("settings.timeSavedNeedsSpeed")
						: stats.timeSavedSeconds >= 0
							? t("settings.timeSaved", {
									duration: formatDuration(Math.abs(stats.timeSavedSeconds)),
								})
							: t("settings.slowerThanTyping", {
									duration: formatDuration(Math.abs(stats.timeSavedSeconds)),
								})}
				</p>
				{settings.typingSpeedWordsPerMinute === null ? null : (
					<p>
						{t("settings.measuredSpeed", {
							speed: Math.round(settings.typingSpeedWordsPerMinute),
						})}
					</p>
				)}
				<p>{t("settings.typingPrompt")}</p>
				<blockquote>{t("settings.calibrationText")}</blockquote>
				{typingStartedAt === null ? (
					<button onClick={startTypingTest} type="button">
						{t("settings.startTypingTest")}
					</button>
				) : (
					<>
						<label htmlFor="typing-test-text">
							{t("settings.typingTestText")}
							<textarea
								id="typing-test-text"
								onChange={(event) => setTypingText(event.target.value)}
								ref={typingInput}
								value={typingText}
							/>
						</label>
						<button onClick={() => void finishTypingTest()} type="button">
							{t("settings.saveMeasuredSpeed")}
						</button>
					</>
				)}
			</section>

			<section aria-labelledby="storage-title" className="settings-section">
				<h3 id="storage-title">{t("settings.storageTitle")}</h3>
				<p>{t("settings.dataDirectory", { path: storage.dataDir })}</p>
				<p>
					{t("settings.usesDisk", { size: formatBytes(storage.usedBytes) })}
				</p>
				<p>
					{t("settings.freeDisk", { size: formatBytes(storage.freeBytes) })}
				</p>
				<a href="/bff/library/export">{t("settings.downloadExport")}</a>
			</section>

			<p aria-live="polite" className="status">
				{message}
			</p>
		</section>
	);
}
