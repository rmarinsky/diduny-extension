export const DEFAULT_DICTATION_SHORTCUT = "Alt+Shift+V";

export interface ShortcutEvent {
	altKey: boolean;
	/** Physical key, e.g. "KeyD"; macOS Option rewrites `key` (Option+D is "∂"). */
	code?: string;
	ctrlKey: boolean;
	key: string;
	metaKey: boolean;
	shiftKey: boolean;
}

export const shortcutModifiers = ["Ctrl", "Alt", "Shift", "Meta"] as const;
export type ShortcutModifier = (typeof shortcutModifiers)[number];
const modifierNames = shortcutModifiers;
const reservedShortcuts = new Set([
	"Ctrl+L",
	"Ctrl+R",
	"Ctrl+Shift+R",
	"Ctrl+T",
	"Ctrl+W",
	"Meta+L",
	"Meta+R",
	"Meta+Shift+R",
	"Meta+T",
	"Meta+W",
]);

function keyName(value: string) {
	if (value === " ") return "Space";
	const key = value.trim();
	if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
	if (/^f(?:[1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
	return key.toLowerCase() === "space" ? "Space" : null;
}

function keyNameFromCode(code: string | undefined) {
	if (!code) return null;
	const match = /^(?:Key([A-Z])|Digit([0-9])|(F(?:[1-9]|1[0-2])))$/.exec(code);
	if (match) return match[1] ?? match[2] ?? match[3] ?? null;
	return code === "Space" ? "Space" : null;
}

/**
 * The shortcut key an event produced. The printed key wins (AZERTY "A" is code
 * KeyQ); the physical key covers macOS Option ("∂") and Cyrillic layouts ("в").
 */
export function shortcutKeyFromEvent(
	event: Pick<ShortcutEvent, "code" | "key">,
) {
	return keyName(event.key) ?? keyNameFromCode(event.code);
}

export function normalizeShortcut(value: unknown): string | null {
	if (typeof value !== "string" || value.length > 64) return null;
	const parts = value.split("+").map((part) => part.trim());
	if (!parts.length || parts.some((part) => !part)) return null;
	const modifiers = new Set<(typeof modifierNames)[number]>();
	let key: string | null = null;
	for (const part of parts) {
		const modifier = modifierNames.find(
			(name) => name.toLowerCase() === part.toLowerCase(),
		);
		if (modifier) {
			if (modifiers.has(modifier)) return null;
			modifiers.add(modifier);
			continue;
		}
		if (key) return null;
		key = keyName(part);
		if (!key) return null;
	}
	if (!key) return null;
	return [...modifierNames.filter((name) => modifiers.has(name)), key].join(
		"+",
	);
}

export function isReservedShortcut(value: string) {
	const shortcut = normalizeShortcut(value);
	return shortcut !== null && reservedShortcuts.has(shortcut);
}

/** Ctrl, Alt, and Meta chords type nothing, so they may fire while a text field has focus. */
export function firesInTextFields(value: string) {
	const shortcut = normalizeShortcut(value);
	if (!shortcut) return false;
	const modifiers = shortcut.split("+").slice(0, -1);
	return ["Ctrl", "Alt", "Meta"].some((name) => modifiers.includes(name));
}

export function matchesShortcut(event: ShortcutEvent, shortcut: string) {
	const normalized = normalizeShortcut(shortcut);
	if (!normalized) return false;
	const parts = normalized.split("+");
	const key = parts.at(-1);
	if (!key || shortcutKeyFromEvent(event) !== key) return false;
	return (
		event.ctrlKey === parts.includes("Ctrl") &&
		event.altKey === parts.includes("Alt") &&
		event.shiftKey === parts.includes("Shift") &&
		event.metaKey === parts.includes("Meta")
	);
}
