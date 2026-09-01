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

export function displayRecordingText(recording: Recording) {
	const isMeeting =
		recording.type === "meeting" || recording.type === "meetingTranslation";
	return isMeeting && recording.segments?.length
		? renderSegments(recording.segments)
		: recording.text;
}

export function copyRecordingText(recording: Recording) {
	return recording.type === "meeting" || recording.type === "meetingTranslation"
		? displayRecordingText(recording)
		: recording.text;
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
