import { expect, test } from "bun:test";
import { commandRecording } from "./command-recording";

const english = {
	diarization: true,
	language: "en",
	mode: "voice" as const,
	translationTargetLanguage: "uk",
};

test("every command records in the spoken language chosen in the side panel", () => {
	expect(commandRecording("voice", english)).toEqual({
		diarization: false,
		language: "en",
		mode: "voice",
	});
	expect(commandRecording("translation", english)).toEqual({
		diarization: false,
		language: "en",
		mode: "translation",
		translation: { targetLanguage: "uk" },
	});
	expect(commandRecording("meeting", english)).toEqual({
		diarization: true,
		language: "en",
		mode: "meeting",
	});
});
