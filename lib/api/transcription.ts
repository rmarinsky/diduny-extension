import { bffFetch } from "../bff/client";
import type { TranscriptionResult } from "../types";

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
		JSON.stringify({
			mode: "transcribe",
			language_hints: config.language_hints ?? ["uk"],
			enable_speaker_diarization: config.enable_speaker_diarization ?? false,
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
