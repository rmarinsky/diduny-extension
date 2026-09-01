export const DEFAULT_SHORTCUT = "Alt+Shift+D";

const reservedShortcuts = new Set([
	"ctrl+l",
	"ctrl+r",
	"ctrl+shift+r",
	"ctrl+t",
	"ctrl+w",
	"meta+l",
	"meta+r",
	"meta+shift+r",
	"meta+t",
	"meta+w",
]);

function normalized(value: string) {
	return value.replaceAll(" ", "").toLowerCase();
}

export function appendTranscript(existing: string, incoming: string) {
	const text = incoming.trim();
	if (!text) return existing;
	return `${existing}${existing && !/\s$/.test(existing) ? " " : ""}${text}`;
}

export function isReservedShortcut(shortcut: string) {
	return reservedShortcuts.has(normalized(shortcut));
}

export function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof Element)) return false;
	return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

export function matchesDictationShortcut(event: KeyboardEvent) {
	return (
		event.altKey &&
		event.shiftKey &&
		!event.ctrlKey &&
		!event.metaKey &&
		event.key.toLowerCase() === "d"
	);
}
