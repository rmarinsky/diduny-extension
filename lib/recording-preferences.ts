import type { RecordingMode } from "./types";

/** What the side panel last chose; keyboard commands record with the same languages. */
export const RECORDING_PREFERENCES_STORAGE_KEY = "didunyRecordingPreferences";

export const SPOKEN_LANGUAGES = ["uk", "en", "uk,en"] as const;
export const TRANSLATION_TARGET_LANGUAGES = ["en", "uk"] as const;

export const SAME_TRANSLATION_LANGUAGE_MESSAGE =
	"Choose two different languages to translate between.";

export interface RecordingPreferences {
	diarization: boolean;
	language: string;
	mode: RecordingMode;
	translationTargetLanguage: string;
}

export const DEFAULT_RECORDING_PREFERENCES: RecordingPreferences = {
	diarization: false,
	language: "uk",
	mode: "voice",
	translationTargetLanguage: "en",
};

function oneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T,
): T {
	return allowed.includes(value as T) ? (value as T) : fallback;
}

function otherTarget(language: string) {
	return (
		TRANSLATION_TARGET_LANGUAGES.find((target) => target !== language) ??
		DEFAULT_RECORDING_PREFERENCES.translationTargetLanguage
	);
}

export function parseRecordingPreferences(
	value: unknown,
): RecordingPreferences {
	const stored =
		value && typeof value === "object"
			? (value as Partial<Record<keyof RecordingPreferences, unknown>>)
			: {};
	const language = oneOf(
		stored.language,
		SPOKEN_LANGUAGES,
		DEFAULT_RECORDING_PREFERENCES.language as "uk",
	);
	const target = oneOf(
		stored.translationTargetLanguage,
		TRANSLATION_TARGET_LANGUAGES,
		DEFAULT_RECORDING_PREFERENCES.translationTargetLanguage as "en",
	);
	return {
		diarization: stored.diarization === true,
		language,
		mode: oneOf(
			stored.mode,
			["voice", "translation", "meeting"] as const,
			DEFAULT_RECORDING_PREFERENCES.mode,
		),
		translationTargetLanguage:
			target === language ? otherTarget(language) : target,
	};
}

/** Picking the language already on the other side swaps the pair, as in the web app. */
export function withSpokenLanguage(
	preferences: RecordingPreferences,
	language: string,
): RecordingPreferences {
	if (language !== preferences.translationTargetLanguage)
		return { ...preferences, language };
	const previous = preferences.language;
	return {
		...preferences,
		language,
		translationTargetLanguage: TRANSLATION_TARGET_LANGUAGES.includes(
			previous as "en",
		)
			? previous
			: otherTarget(language),
	};
}

export function withTranslationTarget(
	preferences: RecordingPreferences,
	translationTargetLanguage: string,
): RecordingPreferences {
	return translationTargetLanguage === preferences.language
		? {
				...preferences,
				language: preferences.translationTargetLanguage,
				translationTargetLanguage,
			}
		: { ...preferences, translationTargetLanguage };
}

export async function getRecordingPreferences(): Promise<RecordingPreferences> {
	try {
		const stored = await chrome.storage.local.get(
			RECORDING_PREFERENCES_STORAGE_KEY,
		);
		return parseRecordingPreferences(stored[RECORDING_PREFERENCES_STORAGE_KEY]);
	} catch {
		return DEFAULT_RECORDING_PREFERENCES;
	}
}

export async function saveRecordingPreferences(
	preferences: RecordingPreferences,
) {
	await chrome.storage.local.set({
		[RECORDING_PREFERENCES_STORAGE_KEY]: preferences,
	});
}
