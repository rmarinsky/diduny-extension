import type { TranscriptSegment } from "../../src/core/models";
import { buildTranscriptionConfig } from "../../src/core/transcription-config";
import { bffFetch } from "../bff/client";
import type { TranscriptionResult, TranscriptionToken } from "../types";

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
): Promise<TranscriptionResult> {
	const form = new FormData();
	form.append("audio", audioBlob, "recording.webm");
	form.append(
		"config",
		new Blob([JSON.stringify(extensionTranscriptionConfig(config))], {
			type: "text/plain",
		}),
	);

	const res = await bffFetch(
		"/bff/extension/api/transcriptions",
		{
			method: "POST",
			body: form,
		},
		bffOrigin,
	);
	if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
	return res.json();
}
