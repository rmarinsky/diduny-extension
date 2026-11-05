// Mirrors validTerms in server.ts.
export const MAX_TERMS = 100;
export const MAX_TERM_LENGTH = 100;

const separators = /[,;\r\n\t]+/;
const edgePunctuation =
	/^[\s"'“”‘’«»()[\]{}.,;:!?]+|[\s"'“”‘’«»()[\]{}.,;:!?]+$/gu;

/** Tidies one entry: single spaces, no surrounding quotes or punctuation; inner "so-called" or "Node.js" survive. */
export function cleanTerm(value: string) {
	return value
		.normalize("NFC")
		.replace(/\s+/gu, " ")
		.replace(edgePunctuation, "")
		.slice(0, MAX_TERM_LENGTH);
}

/** Splits typed or pasted text on commas, semicolons, tabs, and line breaks. */
export function splitTerms(text: string) {
	return text.split(separators).map(cleanTerm).filter(Boolean);
}

/** Appends new entries, skipping case-insensitive duplicates (cleanup matching ignores case). */
export function addTerms(existing: readonly string[], text: string) {
	const seen = new Set(existing.map((term) => term.toLocaleLowerCase()));
	const next = [...existing];
	for (const term of splitTerms(text)) {
		const key = term.toLocaleLowerCase();
		if (seen.has(key) || next.length >= MAX_TERMS) continue;
		seen.add(key);
		next.push(term);
	}
	return next;
}

/** Commits every separator-terminated entry and keeps the unfinished tail as the draft. */
export function splitDraft(existing: readonly string[], value: string) {
	const lastSeparator = value.search(/[,;\r\n\t][^,;\r\n\t]*$/);
	if (lastSeparator === -1) return { draft: value, terms: existing };
	return {
		draft: value.slice(lastSeparator + 1).trimStart(),
		terms: addTerms(existing, value.slice(0, lastSeparator)),
	};
}
