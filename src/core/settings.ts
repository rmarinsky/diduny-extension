import { INPUT_TIMING } from "./constants";
import type { TextCleanup } from "./models";

export type UiLocale = "en" | "uk";
export type Provider = "cloud" | "local";

export interface Settings {
	announceLiveTranscript: boolean;
	fillerWords: readonly string[];
	playSoundOnCompletion: boolean;
	protectedLexicon: readonly string[];
	pushToTalkHoldEnabled: boolean;
	pushToTalkHoldStartDelayMs: number;
	pushToTalkKey: "rightShift";
	pushToTalkToggleEnabled: boolean;
	pushToTalkToggleTapCount: number;
	speechLanguageHints: readonly string[];
	textCleanupEnabled: boolean;
	transcriptionProvider: Provider;
	translationSourceLanguage: string;
	translationTargetLanguage: string;
	typingSpeedWordsPerMinute: number | null;
	uiLocale: UiLocale;
}

// Defaults ported from SettingsStorage.swift:160-179, not its stale prose docs.
export const DEFAULT_SETTINGS: Settings = {
	announceLiveTranscript: false,
	fillerWords: ["um", "uh"],
	playSoundOnCompletion: true,
	protectedLexicon: [],
	pushToTalkHoldEnabled: false,
	pushToTalkHoldStartDelayMs: INPUT_TIMING.pushToTalkHoldStartDelayMs,
	pushToTalkKey: "rightShift",
	pushToTalkToggleEnabled: true,
	pushToTalkToggleTapCount: INPUT_TIMING.tapToggleCount,
	speechLanguageHints: [],
	textCleanupEnabled: true,
	transcriptionProvider: "cloud",
	translationSourceLanguage: "uk",
	translationTargetLanguage: "en",
	typingSpeedWordsPerMinute: null,
	uiLocale: "en",
};

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringList(value: unknown, fallback: readonly string[]) {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
		return fallback;
	return value.map((item) => item.trim()).filter(Boolean);
}

function language(value: unknown, fallback: string) {
	return typeof value === "string" &&
		/^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(value)
		? value
		: fallback;
}

export function normalizeSettings(value: unknown): Settings {
	const settings = record(value);
	const typingSpeed = settings.typingSpeedWordsPerMinute;
	return {
		announceLiveTranscript:
			typeof settings.announceLiveTranscript === "boolean"
				? settings.announceLiveTranscript
				: DEFAULT_SETTINGS.announceLiveTranscript,
		fillerWords: stringList(settings.fillerWords, DEFAULT_SETTINGS.fillerWords),
		playSoundOnCompletion:
			typeof settings.playSoundOnCompletion === "boolean"
				? settings.playSoundOnCompletion
				: DEFAULT_SETTINGS.playSoundOnCompletion,
		protectedLexicon: stringList(
			settings.protectedLexicon,
			DEFAULT_SETTINGS.protectedLexicon,
		),
		pushToTalkHoldEnabled:
			typeof settings.pushToTalkHoldEnabled === "boolean"
				? settings.pushToTalkHoldEnabled
				: DEFAULT_SETTINGS.pushToTalkHoldEnabled,
		pushToTalkHoldStartDelayMs:
			typeof settings.pushToTalkHoldStartDelayMs === "number" &&
			Number.isFinite(settings.pushToTalkHoldStartDelayMs)
				? settings.pushToTalkHoldStartDelayMs
				: DEFAULT_SETTINGS.pushToTalkHoldStartDelayMs,
		pushToTalkKey:
			settings.pushToTalkKey === "rightShift"
				? settings.pushToTalkKey
				: DEFAULT_SETTINGS.pushToTalkKey,
		pushToTalkToggleEnabled:
			typeof settings.pushToTalkToggleEnabled === "boolean"
				? settings.pushToTalkToggleEnabled
				: DEFAULT_SETTINGS.pushToTalkToggleEnabled,
		pushToTalkToggleTapCount:
			typeof settings.pushToTalkToggleTapCount === "number" &&
			Number.isInteger(settings.pushToTalkToggleTapCount)
				? settings.pushToTalkToggleTapCount
				: DEFAULT_SETTINGS.pushToTalkToggleTapCount,
		speechLanguageHints: stringList(
			settings.speechLanguageHints,
			DEFAULT_SETTINGS.speechLanguageHints,
		),
		textCleanupEnabled:
			typeof settings.textCleanupEnabled === "boolean"
				? settings.textCleanupEnabled
				: DEFAULT_SETTINGS.textCleanupEnabled,
		transcriptionProvider:
			settings.transcriptionProvider === "local" ||
			settings.transcriptionProvider === "cloud"
				? settings.transcriptionProvider
				: DEFAULT_SETTINGS.transcriptionProvider,
		translationSourceLanguage: language(
			settings.translationSourceLanguage,
			DEFAULT_SETTINGS.translationSourceLanguage,
		),
		translationTargetLanguage: language(
			settings.translationTargetLanguage,
			DEFAULT_SETTINGS.translationTargetLanguage,
		),
		typingSpeedWordsPerMinute:
			typingSpeed === null ||
			(typeof typingSpeed === "number" &&
				Number.isFinite(typingSpeed) &&
				typingSpeed > 0)
				? typingSpeed
				: DEFAULT_SETTINGS.typingSpeedWordsPerMinute,
		uiLocale:
			settings.uiLocale === "en" || settings.uiLocale === "uk"
				? settings.uiLocale
				: DEFAULT_SETTINGS.uiLocale,
	};
}

export function updateSettings(
	settings: Settings,
	changes: Partial<Settings>,
): Settings {
	return normalizeSettings({ ...settings, ...changes });
}

export function textCleanupFromSettings(settings: Settings): TextCleanup {
	return {
		enabled: settings.textCleanupEnabled,
		fillerWords: settings.fillerWords,
		protectedLexicon: settings.protectedLexicon,
	};
}

export function effectiveProvider(
	configured: Provider,
	availability: Readonly<Record<Provider, boolean>>,
): Provider | null {
	return availability[configured] ? configured : null;
}
