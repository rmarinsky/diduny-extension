import { afterEach, expect, test } from "bun:test";
import { DidunyError } from "../../src/core/errors";
import {
	TRANSCRIPTION_TIMED_OUT_MESSAGE,
	extensionTranscriptionConfig,
	failureMessage,
	transcribeAudio,
	transcriptSegments,
	transcriptionFailureMessage,
} from "./transcription";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("explains upstream failures in the web app's wording instead of a bare status code", () => {
	expect(transcriptionFailureMessage(401, { error: "unauthorized" })).toBe(
		"Your Diduny sign-in has expired. Sign in again, then retry.",
	);
	expect(
		transcriptionFailureMessage(402, { limitHours: 2, usedHours: 2 }),
	).toBe(
		"You are out of hours (2 of 2 used). Add hours or wait for your plan to renew, then try again.",
	);
	expect(transcriptionFailureMessage(500, { error: "upstream_failed" })).toBe(
		"The Diduny service rejected this request. Try again; if it continues, restart the local Diduny service.",
	);
});

test("explains Diduny's own error codes instead of showing them", () => {
	expect(
		failureMessage(new DidunyError("authentication_failed"), "fallback"),
	).toBe("Your Diduny sign-in has expired. Sign in again, then retry.");
	expect(failureMessage(new Error("Plain words"), "fallback")).toBe(
		"Plain words",
	);
	expect(failureMessage("not an error", "fallback")).toBe("fallback");
});

test("stops an upload that never answers once its time limit passes", async () => {
	globalThis.fetch = ((_url: string, init?: RequestInit) =>
		new Promise((_resolve, reject) => {
			init?.signal?.addEventListener("abort", () =>
				reject(new DOMException("Aborted", "AbortError")),
			);
		})) as typeof fetch;
	await expect(
		transcribeAudio(new Blob(["audio"]), {}, "http://localhost:3000", {
			timeoutMs: 10,
		}),
	).rejects.toThrow(TRANSCRIPTION_TIMED_OUT_MESSAGE);
});

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
