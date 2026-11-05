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

/**
 * Longest URL-encoded text sent in one translation request. The text travels
 * in the query string, and Node refuses request heads over 16 KiB, so long
 * pastes are sent in parts.
 */
export const MAX_TRANSLATION_QUERY_LENGTH = 6_000;

export interface TranslationChunk {
	/** Whitespace that followed the chunk in the pasted text. */
	gap: string;
	text: string;
}

function encodedLength(text: string) {
	return new URLSearchParams({ q: text }).toString().length - 2;
}

const sentenceEnd = /[.!?…]["'»”)\]]*\s*$/u;

function splitOversizedWord(word: string, limit: number) {
	if (encodedLength(word) <= limit) return [word];
	const parts: string[] = [];
	let part = "";
	for (const character of word) {
		if (part && encodedLength(part + character) > limit) {
			parts.push(part);
			part = "";
		}
		part += character;
	}
	if (part) parts.push(part);
	return parts;
}

/**
 * Splits pasted text into parts that each fit one request, cutting after a
 * sentence when possible, otherwise between words.
 */
export function translationChunks(
	text: string,
	limit = MAX_TRANSLATION_QUERY_LENGTH,
): TranslationChunk[] {
	const pieces = (text.trim().match(/\S+\s*/gu) ?? []).flatMap((word) =>
		splitOversizedWord(word, limit),
	);
	const chunks: TranslationChunk[] = [];
	let current: string[] = [];
	let length = 0;
	let lastSentenceEnd = 0;
	const flush = (count: number) => {
		const joined = current.slice(0, count).join("");
		const body = joined.trimEnd();
		chunks.push({ gap: joined.slice(body.length), text: body });
		current = current.slice(count);
		length = current.reduce((total, piece) => total + encodedLength(piece), 0);
		lastSentenceEnd = 0;
	};
	for (const piece of pieces) {
		const size = encodedLength(piece);
		if (current.length && length + size > limit)
			flush(lastSentenceEnd || current.length);
		if (current.length && length + size > limit) flush(current.length);
		current.push(piece);
		length += size;
		if (sentenceEnd.test(piece)) lastSentenceEnd = current.length;
	}
	if (current.length) flush(current.length);
	return chunks;
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
