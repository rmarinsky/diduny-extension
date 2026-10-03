import { expect, test } from "bun:test";
import {
	DEFAULT_DICTATION_SHORTCUT,
	firesInTextFields,
	isReservedShortcut,
	matchesShortcut,
	normalizeShortcut,
	shortcutKeyFromEvent,
} from "../src/core";

test("normalizes configured shortcut chords and matches them exactly", () => {
	expect(normalizeShortcut(" shift + alt + d ")).toBe("Alt+Shift+D");
	expect(normalizeShortcut("Space")).toBe("Space");
	expect(normalizeShortcut("Alt+Shift")).toBeNull();
	expect(
		matchesShortcut(
			{
				altKey: true,
				ctrlKey: false,
				key: "d",
				metaKey: false,
				shiftKey: true,
			},
			"Alt+Shift+D",
		),
	).toBeTrue();
	expect(
		matchesShortcut(
			{ altKey: true, ctrlKey: true, key: "d", metaKey: false, shiftKey: true },
			"Alt+Shift+D",
		),
	).toBeFalse();
	expect(
		matchesShortcut(
			{
				altKey: false,
				ctrlKey: false,
				key: " ",
				metaKey: false,
				shiftKey: false,
			},
			"Space",
		),
	).toBeTrue();
});

test("refuses browser-reserved shortcut chords", () => {
	expect(isReservedShortcut("Ctrl+Shift+R")).toBeTrue();
	expect(isReservedShortcut("Alt+Shift+D")).toBeFalse();
});

test("falls back to the physical key when a layout or macOS Option rewrites the character", () => {
	const chord = {
		altKey: true,
		ctrlKey: false,
		metaKey: false,
		shiftKey: true,
	};
	expect(
		matchesShortcut({ ...chord, code: "KeyD", key: "Î" }, "Alt+Shift+D"),
	).toBeTrue();
	expect(
		matchesShortcut({ ...chord, code: "KeyD", key: "В" }, "Alt+Shift+D"),
	).toBeTrue();
	expect(
		matchesShortcut({ ...chord, code: "KeyQ", key: "A" }, "Alt+Shift+A"),
	).toBeTrue();
	expect(
		matchesShortcut({ ...chord, code: "KeyQ", key: "A" }, "Alt+Shift+Q"),
	).toBeFalse();
	expect(shortcutKeyFromEvent({ code: "Digit5", key: "∞" })).toBe("5");
	expect(shortcutKeyFromEvent({ code: "F8", key: "F8" })).toBe("F8");
	expect(shortcutKeyFromEvent({ code: "ShiftLeft", key: "Shift" })).toBeNull();
});

test("Ctrl, Alt, and Meta chords may fire while a text field has focus; typing keys may not", () => {
	expect(DEFAULT_DICTATION_SHORTCUT).toBe("Alt+Shift+V");
	expect(firesInTextFields(DEFAULT_DICTATION_SHORTCUT)).toBeTrue();
	expect(firesInTextFields("Ctrl+M")).toBeTrue();
	expect(firesInTextFields("Meta+Shift+K")).toBeTrue();
	expect(firesInTextFields("Shift+K")).toBeFalse();
	expect(firesInTextFields("Space")).toBeFalse();
	expect(firesInTextFields("not a shortcut")).toBeFalse();
});
