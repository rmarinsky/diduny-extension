export type RecordingType =
	| "fileTranscription"
	| "meeting"
	| "meetingTranslation"
	| "translation"
	| "voice";

export type ProcessingStatus =
	| "failed"
	| "partiallyRecovered"
	| "processing"
	| "transcribed"
	| "translated"
	| "unprocessed";

export interface TranscriptSegment {
	endMs: number;
	language?: string;
	speaker?: string;
	startMs: number;
	text: string;
}

export type TranscriptKind = "cloud" | "local" | "translation";

export interface TranscriptVersion {
	createdAt: number;
	id: string;
	kind: TranscriptKind;
	provider: string;
	segments?: readonly TranscriptSegment[];
	text: string;
}

export interface Recording {
	createdAt: number;
	history?: readonly TranscriptVersion[];
	id: string;
	provider?: string;
	segments?: readonly TranscriptSegment[];
	status: ProcessingStatus;
	text: string;
	title?: string;
	type: RecordingType;
}

export interface TextCleanup {
	enabled: boolean;
	fillerWords: readonly string[];
	protectedLexicon: readonly string[];
}

function timestamp(milliseconds: number) {
	const totalSeconds = Math.floor(milliseconds / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function renderSegments(segments: readonly TranscriptSegment[]) {
	return segments
		.map(
			({ speaker = "?", startMs, text }) =>
				`[${timestamp(startMs)}] Speaker ${speaker}: ${text}`,
		)
		.join("\n");
}

function escaped(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function protectedRanges(text: string, terms: readonly string[]) {
	const ranges: Array<{ end: number; start: number }> = [];
	for (const term of terms) {
		const normalized = term.trim();
		if (!normalized) continue;
		const pattern = new RegExp(escaped(normalized), "giu");
		for (const match of text.matchAll(pattern)) {
			if (match.index === undefined) continue;
			ranges.push({ end: match.index + match[0].length, start: match.index });
		}
	}
	return ranges;
}

export function cleanDictationText(text: string, cleanup: TextCleanup) {
	if (!cleanup.enabled) return text;
	const fillers = [...new Set(cleanup.fillerWords.map((word) => word.trim()))]
		.filter(Boolean)
		.sort((left, right) => right.length - left.length);
	if (!fillers.length) return text;
	const protectedTerms = protectedRanges(text, cleanup.protectedLexicon);
	const pattern = new RegExp(
		`(?<![\\p{L}\\p{N}_])(${fillers.map(escaped).join("|")})(?![\\p{L}\\p{N}_])([\\t ]*[,;:]?[\\t ]*)`,
		"giu",
	);
	let removed = false;
	const withoutFillers = text.replace(
		pattern,
		(match, _filler: string, _tail: string, index: number) => {
			const protectedTerm = protectedTerms.some(
				(range) => index >= range.start && index + _filler.length <= range.end,
			);
			if (protectedTerm) return match;
			removed = true;
			return "";
		},
	);
	if (!removed) return text;
	return withoutFillers
		.replace(/[\t ]{2,}/g, " ")
		.replace(/[\t ]+([,.;:!?])/g, "$1")
		.trim();
}

export function displayRecordingText(
	recording: Recording,
	cleanup?: TextCleanup,
) {
	const isMeeting =
		recording.type === "meeting" || recording.type === "meetingTranslation";
	return isMeeting && recording.segments?.length
		? renderSegments(recording.segments)
		: cleanup
			? cleanDictationText(recording.text, cleanup)
			: recording.text;
}

export function copyRecordingText(recording: Recording, cleanup?: TextCleanup) {
	return displayRecordingText(recording, cleanup);
}

export function wordCount(text: string) {
	return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function timeSavedSeconds(
	text: string,
	dictationDurationSeconds: number,
	wordsPerMinute: number | null,
) {
	return timeSavedSecondsForWords(
		wordCount(text),
		dictationDurationSeconds,
		wordsPerMinute,
	);
}

export function timeSavedSecondsForWords(
	words: number,
	dictationDurationSeconds: number,
	wordsPerMinute: number | null,
) {
	if (
		!Number.isFinite(words) ||
		words < 0 ||
		wordsPerMinute === null ||
		!Number.isFinite(wordsPerMinute) ||
		wordsPerMinute <= 0 ||
		!Number.isFinite(dictationDurationSeconds) ||
		dictationDurationSeconds < 0
	) {
		return null;
	}
	return (words * 60) / wordsPerMinute - dictationDurationSeconds;
}

function legacyKind(recording: Recording): TranscriptKind {
	if (recording.status === "translated") return "translation";
	return /local|whisper/i.test(recording.provider ?? "") ? "local" : "cloud";
}

export function resolveTranscriptHistory(
	recording: Recording,
): readonly TranscriptVersion[] {
	if (recording.history?.length) return recording.history;
	if (!recording.text) return [];
	return [
		{
			createdAt: recording.createdAt,
			id: `${recording.id}:legacy`,
			kind: legacyKind(recording),
			provider: recording.provider ?? "unknown",
			segments: recording.segments,
			text: recording.text,
		},
	];
}
