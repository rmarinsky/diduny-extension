import { expect, test } from "bun:test";
import { extensionTranscriptionConfig } from "./transcription";

test("uses the shared strict hint rule for extension transcription", () => {
	expect(extensionTranscriptionConfig({})).toEqual({
		enable_speaker_diarization: false,
		language_hints: ["uk"],
		language_hints_strict: true,
		mode: "transcribe",
	});
	expect(extensionTranscriptionConfig({ language_hints: [] })).toEqual({
		enable_speaker_diarization: false,
		mode: "transcribe",
	});
});
