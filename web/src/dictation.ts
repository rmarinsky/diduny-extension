import {
	DEFAULT_DICTATION_SHORTCUT,
	isReservedShortcut,
	matchesShortcut,
} from "../../src/core/shortcuts";

export const DEFAULT_SHORTCUT = DEFAULT_DICTATION_SHORTCUT;
export const COMMAND_PALETTE_SHORTCUT = "Alt+Shift+P";
export { isReservedShortcut };

export function appendTranscript(existing: string, incoming: string) {
	const text = incoming.trim();
	if (!text) return existing;
	return `${existing}${existing && !/\s$/.test(existing) ? " " : ""}${text}`;
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
