import {
	DEFAULT_DICTATION_SHORTCUT,
	firesInTextFields,
	isReservedShortcut,
	matchesShortcut,
} from "../../src/core/shortcuts";

export const DEFAULT_SHORTCUT = DEFAULT_DICTATION_SHORTCUT;
export const COMMAND_PALETTE_SHORTCUT = "Alt+Shift+P";
/**
 * Window event the extension dispatches on the web-app tab when its dictation
 * command fires: Chrome hands the key to the extension, so the page never sees it.
 */
export const EXTENSION_DICTATION_EVENT = "diduny:dictation-shortcut";
export { firesInTextFields, isReservedShortcut };

/** Line placed between separate dictations in the document. */
export const DICTATION_SEPARATOR = "\n---\n";

export function appendTranscript(existing: string, incoming: string) {
	const text = incoming.trim();
	if (!text) return existing;
	const current = existing.trimEnd();
	return current ? `${current}${DICTATION_SEPARATOR}${text}` : text;
}

export function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof Element)) return false;
	return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

export function matchesDictationShortcut(
	event: KeyboardEvent,
	shortcut = DEFAULT_SHORTCUT,
) {
	return matchesShortcut(event, shortcut);
}

export function matchesCommandPaletteShortcut(event: KeyboardEvent) {
	return matchesShortcut(event, COMMAND_PALETTE_SHORTCUT);
}
