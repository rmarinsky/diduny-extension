export interface TranscriptionToken {
	text: string;
	is_final: boolean;
	confidence: number;
	start_ms: number;
	end_ms: number;
	speaker?: string;
}

export interface TranscriptionResult {
	text: string;
	tokens: TranscriptionToken[];
}

export type RecordingMode = "voice" | "meeting";
export type RecordingState =
	| "idle"
	| "starting"
	| "recording"
	| "processing"
	| "success"
	| "error";

export interface RealtimeConfig {
	audio_format?: string;
	sample_rate?: number;
	num_channels?: number;
	language_hints?: string[];
	enable_speaker_diarization?: boolean;
}
