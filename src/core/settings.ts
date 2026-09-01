import { INPUT_TIMING } from "./constants";

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
	transcriptionProvider: "cloud",
	translationSourceLanguage: "uk",
	translationTargetLanguage: "en",
	typingSpeedWordsPerMinute: null,
	uiLocale: "en",
};

export function updateSettings(
	settings: Settings,
	changes: Partial<Settings>,
): Settings {
	return { ...settings, ...changes };
}

export function effectiveProvider(
	configured: Provider,
	availability: Readonly<Record<Provider, boolean>>,
): Provider | null {
	return availability[configured] ? configured : null;
}
