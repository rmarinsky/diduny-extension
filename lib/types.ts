const isLocal = import.meta.env.MODE === "development";

export const PROXY_URL = isLocal
	? "http://localhost:3000"
	: "https://diduny-ears-proxy.fly.dev";

export const WS_URL = isLocal
	? "ws://localhost:3000"
	: "wss://diduny-ears-proxy.fly.dev";

export interface AuthTokens {
	accessToken: string;
	refreshToken: string;
	user: { id: string; email: string };
}

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
