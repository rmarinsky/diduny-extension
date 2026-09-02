import { useCallback, useEffect, useState } from "react";
import { crashLog } from "../../../lib/crash-log";
import {
	isDeliveryEnabled,
	requestDeliveryPermission,
} from "../../../lib/delivery/site-settings";
import { onMessage, sendMessage } from "../../../lib/messaging/bridge";
import type { RecordingMode, RecordingState } from "../../../lib/types";

export function useRecording() {
	const [state, setState] = useState<RecordingState>("idle");
	const [mode, setMode] = useState<RecordingMode>("voice");
	const [language, setLanguage] = useState("uk");
	const [translationTargetLanguage, setTranslationTargetLanguage] =
		useState("en");
	const [diarization, setDiarization] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);

	useEffect(() => {
		return onMessage((msg) => {
			if (msg.type === "delivery-availability") {
				setDeliveryNotice(
					msg.available
						? null
						: {
								"no-text-field":
									"Focus a supported text field to insert dictation. Copy the transcript instead.",
								"permission-denied":
									"Diduny needs page access to insert text. Copy the transcript instead.",
								"site-disabled":
									"Delivery is disabled for this site. Copy the transcript instead.",
								"target-unavailable":
									"The original text field is no longer available. Copy the transcript instead.",
								"unsupported-editor":
									"Diduny cannot insert into this editor. Copy the transcript instead.",
							}[msg.reason ?? "no-text-field"],
				);
			}
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

	const startRecording = useCallback(async () => {
		setError(null);
		setDeliveryNotice(null);
		const [tab] = await chrome.tabs.query({
			active: true,
			lastFocusedWindow: true,
		});
		if (mode !== "meeting") {
			if (tab?.url && (await isDeliveryEnabled(tab.url)))
				await requestDeliveryPermission(tab.url);
		}

		crashLog(
			"sidepanel:startRecording",
			"info",
			`mode=${mode}, lang=${language}`,
		);

		sendMessage({
			type: "start-recording",
			mode,
			language,
			diarization: mode === "meeting" ? diarization : false,
			translation:
				mode === "translation"
					? { targetLanguage: translationTargetLanguage }
					: undefined,
			targetTabId: mode === "meeting" ? tab?.id : undefined,
		});
	}, [mode, language, diarization, translationTargetLanguage]);

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

	const setTranslationTargetLanguageLogged = useCallback((l: string) => {
		crashLog("sidepanel:ui", "info", `translation target → ${l}`);
		setTranslationTargetLanguage(l);
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
		translationTargetLanguage,
		setTranslationTargetLanguage: setTranslationTargetLanguageLogged,
		diarization,
		setDiarization: setDiarizationLogged,
		deliveryNotice,
		error,
		toggleRecording,
	};
}
