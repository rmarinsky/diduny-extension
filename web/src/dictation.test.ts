import { expect, test } from "bun:test";
import {
	COMMAND_PALETTE_SHORTCUT,
	appendTranscript,
	isReservedShortcut,
} from "./dictation";

test("appends a completed dictation without replacing the working document", () => {
	expect(appendTranscript("Draft", "next sentence")).toBe(
		"Draft next sentence",
	);
	expect(appendTranscript("Draft ", "next sentence")).toBe(
		"Draft next sentence",
	);
});

test("refuses browser-reserved keyboard chords", () => {
	expect(isReservedShortcut("Ctrl+Shift+R")).toBe(true);
	expect(isReservedShortcut("Alt+Shift+D")).toBe(false);
	expect(isReservedShortcut(COMMAND_PALETTE_SHORTCUT)).toBe(false);
});
