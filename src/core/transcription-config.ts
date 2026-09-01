export type TranscriptionTranslation =
	| {
			sourceLanguage?: string;
			targetLanguage: string;
			type?: "one_way";
	  }
	| {
			languageA: string;
			languageB: string;
			type: "two_way";
	  };

export function buildTranscriptionConfig({
	enableSpeakerDiarization = false,
	languageHints = [],
	translation,
}: {
	enableSpeakerDiarization?: boolean;
	languageHints?: readonly string[];
	translation?: TranscriptionTranslation;
}) {
	const hints = languageHints.filter(Boolean);
	return {
		enable_speaker_diarization: enableSpeakerDiarization,
		...(hints.length
			? { language_hints: hints, language_hints_strict: true }
			: {}),
		mode: translation ? "translate" : "transcribe",
		...(translation
			? {
					translation:
						translation.type === "two_way"
							? {
									language_a: translation.languageA,
									language_b: translation.languageB,
									type: "two_way" as const,
								}
							: {
									target_language: translation.targetLanguage,
									type: "one_way" as const,
								},
				}
			: {}),
	};
}
