import { useCallback, useEffect, useState } from "react";
import { crashLog } from "../../../lib/crash-log";
import { onMessage, sendMessage } from "../../../lib/messaging/bridge";
import type { RecordingMode, RecordingState } from "../../../lib/types";

interface DesktopCaptureSelection {
	streamId: string;
	canRequestAudioTrack: boolean;
}

export function useRecording() {
	const [state, setState] = useState<RecordingState>("idle");
	const [mode, setMode] = useState<RecordingMode>("voice");
	const [language, setLanguage] = useState("uk");
	const [diarization, setDiarization] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		return onMessage((msg) => {
			if (msg.type === "recording-state-changed") {
				crashLog(
					"sidepanel:state",
					"info",
					`${state} → ${msg.state}${msg.error ? ` (${msg.error})` : ""}`,
				);
				setState(msg.state);
				if (msg.error) setError(msg.error);
				if (msg.state === "idle" || msg.state === "success") {
					setError(null);
				}
			}
		});
	}, [state]);

	const chooseMeetingSource = useCallback(async (): Promise<
		DesktopCaptureSelection | undefined
	> => {
		return new Promise((resolve, reject) => {
			try {
				chrome.desktopCapture.chooseDesktopMedia(
					["screen", "window", "tab", "audio"],
					(id, options) => {
						try {
							if (chrome.runtime.lastError) {
								const err = new Error(chrome.runtime.lastError.message);
								crashLog("sidepanel:desktopCapture", "error", err.message);
								reject(err);
								return;
							}

							if (!id) {
								resolve(undefined);
								return;
							}

							crashLog(
								"sidepanel:desktopCapture",
								"info",
								`Selected: id=${id}, canRequestAudio=${options?.canRequestAudioTrack}`,
							);

							resolve({
								streamId: id,
								canRequestAudioTrack: options?.canRequestAudioTrack ?? false,
							});
						} catch (err) {
							crashLog(
								"sidepanel:desktopCapture:callback",
								"error",
								err instanceof Error ? err.message : String(err),
								err instanceof Error ? err.stack : undefined,
							);
							reject(err);
						}
					},
				);
			} catch (err) {
				crashLog(
					"sidepanel:desktopCapture:call",
					"error",
					err instanceof Error ? err.message : String(err),
					err instanceof Error ? err.stack : undefined,
				);
				reject(err);
			}
		});
	}, []);

	const startRecording = useCallback(async () => {
		setError(null);

		let selection: DesktopCaptureSelection | undefined;
		if (mode === "meeting") {
			try {
				selection = await chooseMeetingSource();
			} catch (err) {
				crashLog(
					"sidepanel:startRecording",
					"error",
					err instanceof Error ? err.message : String(err),
					err instanceof Error ? err.stack : undefined,
				);
				setError(
					err instanceof Error ? err.message : "Failed to select source",
				);
				return;
			}
			if (!selection) return;
		}

		crashLog(
			"sidepanel:startRecording",
			"info",
			`mode=${mode}, lang=${language}, streamId=${selection?.streamId ?? "none"}`,
		);

		sendMessage({
			type: "start-recording",
			mode,
			language,
			diarization: mode === "meeting" ? diarization : false,
			streamId: selection?.streamId,
			canRequestAudioTrack: selection?.canRequestAudioTrack,
		});
	}, [mode, language, diarization, chooseMeetingSource]);

	const stopRecording = useCallback(() => {
		crashLog("sidepanel:recording", "info", "stopRecording");
		sendMessage({ type: "stop-recording" });
	}, []);

	const toggleRecording = useCallback(() => {
		crashLog(
			"sidepanel:recording",
			"info",
			`toggleRecording (state=${state}, mode=${mode})`,
		);
		if (state === "recording") {
			stopRecording();
		} else if (state === "idle" || state === "success" || state === "error") {
			void startRecording();
		}
	}, [state, mode, startRecording, stopRecording]);

	const setModeLogged = useCallback((m: RecordingMode) => {
		crashLog("sidepanel:ui", "info", `mode → ${m}`);
		setMode(m);
	}, []);

	const setLanguageLogged = useCallback((l: string) => {
		crashLog("sidepanel:ui", "info", `language → ${l}`);
		setLanguage(l);
	}, []);

	const setDiarizationLogged = useCallback((v: boolean) => {
		crashLog("sidepanel:ui", "info", `diarization → ${v}`);
		setDiarization(v);
	}, []);

	return {
		state,
		mode,
		setMode: setModeLogged,
		language,
		setLanguage: setLanguageLogged,
		diarization,
		setDiarization: setDiarizationLogged,
		error,
		toggleRecording,
	};
}
