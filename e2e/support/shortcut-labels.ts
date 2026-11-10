import type { ShortcutModifier } from "../../src/core/shortcuts";
import {
	type ShortcutPlatform,
	displayShortcut,
	modifierLabel,
	parseShortcut,
} from "../../web/src/shortcut-editor";

/** The platform the browser under test reports, mapped like the product does. */
export const testPlatform: ShortcutPlatform =
	process.platform === "darwin"
		? "mac"
		: process.platform === "win32"
			? "windows"
			: "other";

/** What the web app shows for a canonical chord, e.g. "Alt+V" -> "⌥ Option + V" on macOS. */
export function shortcutLabel(canonical: string) {
	return displayShortcut(parseShortcut(canonical), testPlatform);
}

/** The accessible name of a modifier toggle button in the shortcut editor. */
export function modifierButtonName(modifier: ShortcutModifier) {
	return modifierLabel(modifier, testPlatform);
}

const macCommandGlyphs: Record<ShortcutModifier, string> = {
	Ctrl: "⌃",
	Alt: "⌥",
	Shift: "⇧",
	Meta: "⌘",
};

/** What chrome.commands reports for a manifest shortcut: "Alt+Shift+M", or "⌥⇧M" on macOS. */
export function chromeCommandShortcut(canonical: string) {
	if (testPlatform !== "mac") return canonical;
	const { key, modifiers } = parseShortcut(canonical);
	const order: ShortcutModifier[] = ["Ctrl", "Alt", "Shift", "Meta"];
	return (
		order
			.filter((modifier) => modifiers.includes(modifier))
			.map((modifier) => macCommandGlyphs[modifier])
			.join("") + key
	);
}

/** Moves the caret to the end of a textarea: Ctrl+End, or ⌘↓ on macOS where Ctrl+End does nothing. */
export const endOfTextKey =
	testPlatform === "mac" ? "Meta+ArrowDown" : "Control+End";
