import { TRANSCRIPTION_UPLOAD_TIMEOUT } from "../../src/core/constants";
import { isDidunyError } from "../../src/core/errors";
import type { TranscriptSegment } from "../../src/core/models";
import { buildTranscriptionConfig } from "../../src/core/transcription-config";
import { errorFromResponse, userErrorMessage } from "../../web/src/errors";
import { en } from "../../web/src/locales/en";
import { bffFetch } from "../bff/client";
import type { TranscriptionResult, TranscriptionToken } from "../types";

export const TRANSCRIPTION_TIMED_OUT_MESSAGE =
	"Transcription took too long and was stopped. Nothing was inserted; record again to retry.";

/** The extension has no i18n, so it explains failures in the web app's English wording. */
function english(key: string, values: Record<string, unknown> = {}) {
	const text = key
		.split(".")
		.reduce<unknown>(
			(node, part) =>
				node && typeof node === "object"
					? (node as Record<string, unknown>)[part]
					: undefined,
			en,
		);
	return typeof text === "string"
		? text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
				name in values ? String(values[name]) : placeholder,
			)
		: key;
}

export function transcriptionFailureMessage(status: number, body: unknown) {
	return userErrorMessage(errorFromResponse(status, body), english);
}

/** Any failure in words for the panel: Diduny's own errors carry a code, not a sentence. */
export function failureMessage(error: unknown, fallback: string) {
	if (isDidunyError(error)) return userErrorMessage(error, english);
	return error instanceof Error && error.message ? error.message : fallback;
}

/** Without a limit an upload that never answers leaves the panel on Processing forever. */
export function transcriptionUploadTimeoutMs(durationSeconds: number) {
	return (
		TRANSCRIPTION_UPLOAD_TIMEOUT.baseMs +
		Math.max(0, durationSeconds) *
			TRANSCRIPTION_UPLOAD_TIMEOUT.perRecordedSecondMs
	);
}

export function extensionTranscriptionConfig(config: {
	enable_speaker_diarization?: boolean;
	language_hints?: string[];
	translation?: { targetLanguage: string };
}) {
	return buildTranscriptionConfig({
		enableSpeakerDiarization: config.enable_speaker_diarization,
		languageHints: config.language_hints ?? ["uk"],
		translation: config.translation,
	});
}

export function transcriptSegments(
	tokens: readonly TranscriptionToken[],
): readonly TranscriptSegment[] {
	return tokens.flatMap((token) => {
		if (
			!token.is_final ||
			!Number.isSafeInteger(token.start_ms) ||
			!Number.isSafeInteger(token.end_ms) ||
			token.start_ms < 0 ||
			token.end_ms < token.start_ms ||
			!token.text.trim()
		)
			return [];
		return [
			{
				endMs: token.end_ms,
				...(token.speaker ? { speaker: token.speaker } : {}),
				startMs: token.start_ms,
				text: token.text,
			},
		];
	});
}

export async function transcribeAudio(
	audioBlob: Blob,
	config: {
		language_hints?: string[];
		enable_speaker_diarization?: boolean;
		translation?: { targetLanguage: string };
	},
	bffOrigin?: string,
	{ timeoutMs }: { timeoutMs?: number } = {},
): Promise<TranscriptionResult> {
	const form = new FormData();
	form.append("audio", audioBlob, "recording.webm");
	form.append(
		"config",
		new Blob([JSON.stringify(extensionTranscriptionConfig(config))], {
			type: "text/plain",
		}),
	);

	const upload = new AbortController();
	const timer =
		timeoutMs === undefined
			? undefined
			: setTimeout(() => upload.abort(), timeoutMs);
	try {
		const res = await bffFetch(
			"/bff/extension/api/transcriptions",
			{
				method: "POST",
				body: form,
				signal: upload.signal,
			},
			bffOrigin,
		);
		if (!res.ok)
			throw new Error(
				transcriptionFailureMessage(
					res.status,
					await res.json().catch(() => null),
				),
			);
		return (await res.json()) as TranscriptionResult;
	} catch (error) {
		if (upload.signal.aborted) throw new Error(TRANSCRIPTION_TIMED_OUT_MESSAGE);
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
