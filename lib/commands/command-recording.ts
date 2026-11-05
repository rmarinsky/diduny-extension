import type { DictationTranslation } from "../messaging/types";
import type { RecordingPreferences } from "../recording-preferences";
import type { RecordingMode } from "../types";

export interface RecordingRequest {
	diarization: boolean;
	language: string;
	mode: RecordingMode;
	targetTabId?: number;
	translation?: DictationTranslation;
}

/** A keyboard command records its own mode in the languages chosen in the side panel. */
export function commandRecording(
	mode: RecordingMode,
	preferences: RecordingPreferences,
): RecordingRequest {
	return {
		diarization: mode === "meeting" ? preferences.diarization : false,
		language: preferences.language,
		mode,
		...(mode === "translation"
			? {
					translation: {
						targetLanguage: preferences.translationTargetLanguage,
					},
				}
			: {}),
	};
}
