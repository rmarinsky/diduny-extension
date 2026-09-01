import { buildTranscriptionConfig } from "../../src/core/transcription-config";
import { bffFetch } from "../bff/client";
import type { TranscriptionResult } from "../types";

export function extensionTranscriptionConfig(config: {
	enable_speaker_diarization?: boolean;
	language_hints?: string[];
}) {
	return buildTranscriptionConfig({
		enableSpeakerDiarization: config.enable_speaker_diarization,
		languageHints: config.language_hints ?? ["uk"],
	});
}

export async function transcribeAudio(
	audioBlob: Blob,
	config: {
		language_hints?: string[];
		enable_speaker_diarization?: boolean;
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
