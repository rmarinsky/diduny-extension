export interface TranslationPair {
	sourceLanguage: string;
	targetLanguage: string;
}

export function buildTranscriptionConfig({
	languageHints,
	translation,
}: {
	languageHints: readonly string[];
	translation?: TranslationPair;
}) {
	return {
		enable_speaker_diarization: false,
		language_hints: languageHints,
		...(languageHints.length ? { language_hints_strict: true } : {}),
		mode: translation ? "translate" : "transcribe",
		...(translation
			? {
					translation: {
						target_language: translation.targetLanguage,
						type: "one_way" as const,
					},
				}
			: {}),
	};
}

export function translationUrl(text: string, pair: TranslationPair) {
	const query = new URLSearchParams({
		q: text,
		sl: pair.sourceLanguage,
		tl: pair.targetLanguage,
	});
	return `/bff/api/translations?${query}`;
}

export function translationResultText(value: unknown) {
	if (!value || typeof value !== "object" || !("sentences" in value)) return "";
	const sentences = value.sentences;
	if (!Array.isArray(sentences)) return "";
	return sentences
		.map((sentence) =>
			sentence &&
			typeof sentence === "object" &&
			"trans" in sentence &&
			typeof sentence.trans === "string"
				? sentence.trans
				: "",
		)
		.join("");
}
