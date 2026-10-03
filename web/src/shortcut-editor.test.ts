import { expect, test } from "bun:test";
import {
	composeShortcut,
	displayShortcut,
	parseShortcut,
	shortcutPlatform,
	toggleModifier,
} from "./shortcut-editor";

test("detects the platform from userAgentData or the legacy platform string", () => {
	expect(shortcutPlatform({ userAgentData: { platform: "macOS" } })).toBe(
		"mac",
	);
	expect(shortcutPlatform({ platform: "MacIntel" })).toBe("mac");
	expect(shortcutPlatform({ platform: "Win32" })).toBe("windows");
	expect(shortcutPlatform({ platform: "Linux x86_64" })).toBe("other");
	expect(shortcutPlatform({})).toBe("other");
});

test("round-trips a saved chord through toggles and a key", () => {
	const parts = parseShortcut("Alt+Shift+D");
	expect(parts).toEqual({ key: "D", modifiers: ["Alt", "Shift"] });
	expect(composeShortcut(toggleModifier(parts, "Ctrl"))).toBe(
		"Ctrl+Alt+Shift+D",
	);
	expect(composeShortcut(toggleModifier(parts, "Alt"))).toBe("Shift+D");
	expect(composeShortcut({ key: "", modifiers: ["Alt"] })).toBeNull();
	expect(parseShortcut("not a shortcut")).toEqual({ key: "", modifiers: [] });
});

test("shows macOS key names on a Mac and plain names elsewhere", () => {
	const parts = parseShortcut("Meta+Alt+Shift+D");
	expect(displayShortcut(parts, "mac")).toBe(
		"⌥ Option + ⇧ Shift + ⌘ Command + D",
	);
	expect(displayShortcut(parts, "windows")).toBe("Alt + Shift + ⊞ Win + D");
	expect(displayShortcut(parts, "other")).toBe("Alt + Shift + Meta + D");
});
