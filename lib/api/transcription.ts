import type { TranscriptionResult } from "../types";
import { apiFetch } from "./client";

export async function transcribeAudio(
	audioBlob: Blob,
	config: {
		language_hints?: string[];
		enable_speaker_diarization?: boolean;
	},
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

	const res = await apiFetch("/api/v1/transcriptions", {
		method: "POST",
		body: form,
	});
	return res.json();
}
