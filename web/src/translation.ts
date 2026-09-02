export { buildTranscriptionConfig } from "../../src/core/transcription-config";
import { DidunyError } from "../../src/core/errors";

export interface TranslationPair {
	sourceLanguage: string;
	targetLanguage: string;
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
	const text = sentences
		.map((sentence) =>
			sentence &&
			typeof sentence === "object" &&
			"trans" in sentence &&
			typeof sentence.trans === "string"
				? sentence.trans
				: "",
		)
		.join("")
		.trim();
	if (!text) throw new DidunyError("empty_result");
	return text;
}
