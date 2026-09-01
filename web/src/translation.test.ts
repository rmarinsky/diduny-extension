import { expect, test } from "bun:test";
import {
	buildTranscriptionConfig,
	translationResultText,
	translationUrl,
} from "./translation";

test("builds an explicit one-way translation request without consulting UI locale", () => {
	expect(
		buildTranscriptionConfig({
			languageHints: ["uk"],
			translation: { sourceLanguage: "uk", targetLanguage: "en" },
		}),
	).toEqual({
		enable_speaker_diarization: false,
		language_hints: ["uk"],
		language_hints_strict: true,
		mode: "translate",
		translation: { target_language: "en", type: "one_way" },
	});
	const url = new URL(
		translationUrl("Привіт, світе", {
			sourceLanguage: "uk",
			targetLanguage: "en",
		}),
		"https://diduny.test",
	);
	expect(url.pathname).toBe("/bff/api/translations");
	expect(Object.fromEntries(url.searchParams)).toEqual({
		q: "Привіт, світе",
		sl: "uk",
		tl: "en",
	});
});

test("joins the translated sentences returned by the proxy", () => {
	expect(
		translationResultText({
			sentences: [{ trans: "Hello" }, { trans: " world" }],
		}),
	).toBe("Hello world");
	expect(translationResultText({ sentences: [] })).toBe("");
});
