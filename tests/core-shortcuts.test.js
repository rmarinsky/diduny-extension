import { expect, test } from "bun:test";
import {
	isReservedShortcut,
	matchesShortcut,
	normalizeShortcut,
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
