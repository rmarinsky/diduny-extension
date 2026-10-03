import { useCallback, useEffect, useRef, useState } from "react";
import { crashLog } from "../../../lib/crash-log";
import {
	isDeliveryEnabled,
	requestDeliveryPermission,
} from "../../../lib/delivery/site-settings";
import { onMessage, sendMessage } from "../../../lib/messaging/bridge";
import type { DeliveryAvailability } from "../../../lib/messaging/types";
import {
	DEFAULT_RECORDING_PREFERENCES,
	type RecordingPreferences,
	getRecordingPreferences,
	saveRecordingPreferences,
	withSpokenLanguage,
	withTranslationTarget,
} from "../../../lib/recording-preferences";
import type { RecordingMode, RecordingState } from "../../../lib/types";

const DELIVERY_NOTICES: Record<
	NonNullable<DeliveryAvailability["reason"]>,
	string
> = {
	"browser-page":
		"Diduny cannot type into browser pages like this one. Copy the transcript instead.",
	"diduny-web-app":
		"Diduny does not type into its own web app. The text stays here; copy it if you need it there.",
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
};

function requestRecordingState() {
	return new Promise<{ mode?: RecordingMode; state?: RecordingState }>(
		(resolve) => {
			chrome.runtime.sendMessage({ type: "getRecordingState" }, (response) => {
				resolve(chrome.runtime.lastError || !response ? {} : response);
			});
		},
	);
}

export function useRecording() {
	const [state, setState] = useState<RecordingState>("idle");
	const [preferences, setPreferences] = useState<RecordingPreferences>(
		DEFAULT_RECORDING_PREFERENCES,
	);
	const [error, setError] = useState<string | null>(null);
	const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);
	const [waitingForMicrophone, setWaitingForMicrophone] = useState(false);
	const loaded = useRef(false);
	const { diarization, language, mode, translationTargetLanguage } =
		preferences;

	// The panel can close and reopen at any time: restore its choices and the
	// recording that may still be running in the background.
	useEffect(() => {
		void Promise.all([getRecordingPreferences(), requestRecordingState()]).then(
			([saved, running]) => {
				const recordingNow =
					running.state === "starting" ||
					running.state === "recording" ||
					running.state === "processing";
				setPreferences(
					recordingNow && running.mode
						? { ...saved, mode: running.mode }
						: saved,
				);
				if (recordingNow && running.state) setState(running.state);
				loaded.current = true;
			},
		);
	}, []);

	useEffect(() => {
		if (loaded.current) void saveRecordingPreferences(preferences);
	}, [preferences]);

	useEffect(() => {
		return onMessage((msg) => {
			if (msg.type === "delivery-availability") {
				setDeliveryNotice(
					msg.available
						? null
						: DELIVERY_NOTICES[msg.reason ?? "no-text-field"],
				);
			}
			if (msg.type === "microphone-permission") setWaitingForMicrophone(true);
			if (msg.type === "recording-state-changed") {
				crashLog(
					"sidepanel:state",
					"info",
					`${state} → ${msg.state}${msg.error ? ` (${msg.error})` : ""}`,
				);
				setState(msg.state);
				// A shortcut can start a meeting while the panel shows Voice; show what is recording.
				const runningMode = msg.mode;
				if (
					runningMode &&
					(msg.state === "starting" || msg.state === "recording")
				)
					setPreferences((previous) =>
						previous.mode === runningMode
							? previous
							: { ...previous, mode: runningMode },
					);
				if (msg.state !== "starting") setWaitingForMicrophone(false);
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
		setPreferences((previous) => ({ ...previous, mode: m }));
	}, []);

	const setLanguageLogged = useCallback((l: string) => {
		crashLog("sidepanel:ui", "info", `language → ${l}`);
		setPreferences((previous) => withSpokenLanguage(previous, l));
	}, []);

	const setTranslationTargetLanguageLogged = useCallback((l: string) => {
		crashLog("sidepanel:ui", "info", `translation target → ${l}`);
		setPreferences((previous) => withTranslationTarget(previous, l));
	}, []);

	const setDiarizationLogged = useCallback((v: boolean) => {
		crashLog("sidepanel:ui", "info", `diarization → ${v}`);
		setPreferences((previous) => ({ ...previous, diarization: v }));
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
		waitingForMicrophone,
	};
}
