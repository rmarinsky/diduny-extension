import { expect, test } from "bun:test";
import {
	DEFAULT_RECORDING_PREFERENCES,
	parseRecordingPreferences,
	withSpokenLanguage,
	withTranslationTarget,
} from "./recording-preferences";

test("falls back to Voice, Ukrainian into English for missing or unknown values", () => {
	expect(parseRecordingPreferences(undefined)).toEqual(
		DEFAULT_RECORDING_PREFERENCES,
	);
	expect(
		parseRecordingPreferences({
			diarization: "yes",
			language: "de",
			mode: "dictation",
			translationTargetLanguage: "fr",
		}),
	).toEqual(DEFAULT_RECORDING_PREFERENCES);
	expect(
		parseRecordingPreferences({
			diarization: true,
			language: "en",
			mode: "translation",
			translationTargetLanguage: "uk",
		}),
	).toEqual({
		diarization: true,
		language: "en",
		mode: "translation",
		translationTargetLanguage: "uk",
	});
});

test("never restores a pair that translates a language into itself", () => {
	expect(
		parseRecordingPreferences({
			language: "uk",
			translationTargetLanguage: "uk",
		}).translationTargetLanguage,
	).toBe("en");
});

test("picking the language on the other side swaps the pair", () => {
	const ukToEn = DEFAULT_RECORDING_PREFERENCES;
	expect(withTranslationTarget(ukToEn, "uk")).toMatchObject({
		language: "en",
		translationTargetLanguage: "uk",
	});
	expect(withSpokenLanguage(ukToEn, "en")).toMatchObject({
		language: "en",
		translationTargetLanguage: "uk",
	});
	expect(
		withSpokenLanguage(
			{ ...ukToEn, language: "uk,en", translationTargetLanguage: "en" },
			"en",
		),
	).toMatchObject({ language: "en", translationTargetLanguage: "uk" });
	expect(withSpokenLanguage(ukToEn, "uk,en")).toMatchObject({
		language: "uk,en",
		translationTargetLanguage: "en",
	});
});
