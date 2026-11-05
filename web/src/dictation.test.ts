import { expect, test } from "bun:test";
import {
	COMMAND_PALETTE_SHORTCUT,
	appendTranscript,
	isReservedShortcut,
} from "./dictation";

test("appends each completed dictation below a --- line without replacing the document", () => {
	expect(appendTranscript("", " first ")).toBe("first");
	expect(appendTranscript(" \n", "first")).toBe("first");
	expect(appendTranscript("first", "second")).toBe("first\n---\nsecond");
	expect(appendTranscript("first \n", "second")).toBe("first\n---\nsecond");
	expect(appendTranscript("first", "  ")).toBe("first");
});

test("refuses browser-reserved keyboard chords", () => {
	expect(isReservedShortcut("Ctrl+Shift+R")).toBe(true);
	expect(isReservedShortcut("Alt+Shift+D")).toBe(false);
	expect(isReservedShortcut(COMMAND_PALETTE_SHORTCUT)).toBe(false);
});
