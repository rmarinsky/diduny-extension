/** Languages offered as dictation hints and translation pairs. */
export const dictationLanguages = ["uk", "en"] as const;

/** A language's name in that language, e.g. "Українська" for "uk". */
export function ownLanguageName(code: string) {
	let name = code;
	try {
		name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
	} catch {
		return code;
	}
	// Some ICU builds return "українська"; a label starts with a capital.
	return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
}
