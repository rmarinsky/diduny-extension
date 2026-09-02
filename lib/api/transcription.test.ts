import { expect, test } from "bun:test";
import {
	extensionTranscriptionConfig,
	transcriptSegments,
} from "./transcription";

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
	expect(
		extensionTranscriptionConfig({
			language_hints: ["uk"],
			translation: { targetLanguage: "en" },
		}),
	).toEqual({
		enable_speaker_diarization: false,
		language_hints: ["uk"],
		language_hints_strict: true,
		mode: "translate",
		translation: { target_language: "en", type: "one_way" },
	});
});

test("keeps only timed speaker segments that the library can persist", () => {
	expect(
		transcriptSegments([
			{
				confidence: 1,
				end_ms: 480,
				is_final: true,
				speaker: "1",
				start_ms: 0,
				text: "First speaker",
			},
			{
				confidence: 1,
				end_ms: 100,
				is_final: false,
				start_ms: 200,
				text: "Invalid timing",
			},
		]),
	).toEqual([
		{
			endMs: 480,
			speaker: "1",
			startMs: 0,
			text: "First speaker",
		},
	]);
});
