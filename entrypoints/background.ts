import {
	getTokens,
	refreshOnStartup,
	refreshTokens,
	setupAlarmListener,
} from "../lib/auth/token-manager";
import { crashLog, getCrashLogs, logError } from "../lib/crash-log";
import { onMessage, sendMessage } from "../lib/messaging/bridge";
import type { Message } from "../lib/messaging/types";
import type { RecordingMode, RecordingState } from "../lib/types";

interface DesktopCaptureSelection {
	streamId: string;
	canRequestAudioTrack: boolean;
}

export default defineBackground(() => {
	let currentState: RecordingState = "idle";
	const completedSources = new Set<string>();
	const KEEPALIVE_ALARM = "recording-keepalive";

	// Keepalive: prevent SW from sleeping during recording
	chrome.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === KEEPALIVE_ALARM) {
			crashLog("bg:keepalive", "info", `state=${currentState}`);
		}
	});

	function startKeepalive() {
		chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
	}

	function stopKeepalive() {
		chrome.alarms.clear(KEEPALIVE_ALARM);
	}

	// Side panel opens on action click
	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

	// Set up token refresh alarm and refresh on startup
	setupAlarmListener();
	refreshOnStartup();

	// Log uncaught errors in service worker
	self.addEventListener("error", (event) => {
		crashLog(
			"bg",
			"error",
			event.message,
			event.error instanceof Error ? event.error.stack : undefined,
		);
	});
	self.addEventListener("unhandledrejection", (event) => {
		const reason = event.reason;
		crashLog(
			"bg",
			"error",
			reason instanceof Error ? reason.message : String(reason),
			reason instanceof Error ? reason.stack : undefined,
		);
	});

	crashLog("bg", "info", "Service worker started");

	// Dump crash logs on startup for debugging
	getCrashLogs().then((logs) => {
		if (logs.length > 0) {
			console.log("[diduny] Crash logs:", JSON.stringify(logs, null, 2));
		}
	});

	// Recover state on SW restart: if offscreen doc exists, we were recording
	chrome.offscreen
		.hasDocument()
		.then((exists) => {
			if (exists) {
				currentState = "recording";
				updateBadge("recording");
			}
		})
		.catch(() => {});

	// Keyboard shortcut: Alt+Shift+D toggles recording
	chrome.commands.onCommand.addListener(async (command) => {
		if (command !== "toggle-recording") return;

		if (currentState === "recording") {
			await stopRecording();
		} else if (
			currentState === "idle" ||
			currentState === "success" ||
			currentState === "error"
		) {
			await startRecording("voice", "uk", false);
		}
	});

	// Message routing
	onMessage(async (msg) => {
		crashLog("bg:msg", "info", `received: ${msg.type}`);
		switch (msg.type) {
			case "start-recording": {
				await startRecording(
					msg.mode,
					msg.language,
					msg.diarization,
					msg.streamId
						? {
								streamId: msg.streamId,
								canRequestAudioTrack: msg.canRequestAudioTrack ?? false,
							}
						: undefined,
				);
				break;
			}
			case "stop-recording": {
				await stopRecording();
				break;
			}
			case "capture-tokens": {
				await sendMessage({
					type: "realtime-tokens",
					tokens: msg.tokens,
					source: msg.source,
				});
				break;
			}
			case "capture-complete": {
				await sendMessage({
					type: "transcription-complete",
					text: msg.text,
					source: msg.source,
				});
				completedSources.add(msg.source);
				if (completedSources.size >= 1) {
					await setState("success");
					await closeOffscreen();
					completedSources.clear();
				}
				break;
			}
			case "capture-error": {
				await setState("error", msg.error);
				await closeOffscreen();
				break;
			}
		}
	});

	async function startRecording(
		mode: RecordingMode,
		language: string,
		diarization: boolean,
		selection?: DesktopCaptureSelection,
	) {
		crashLog(
			"bg:startRecording",
			"info",
			`mode=${mode}, lang=${language}, diarization=${diarization}, hasStream=${!!selection?.streamId}`,
		);

		const tokens = await getFreshTokensForRecording();
		if (!tokens) {
			await setState("error", "Not authenticated");
			return;
		}

		try {
			// Ensure mic permission is granted
			await ensureMicPermission();
			crashLog("bg:startRecording", "info", "mic permission OK");

			// Stream IDs expire quickly, so do all slow setup before requesting one.
			await createOffscreen();
			crashLog("bg:startRecording", "info", "offscreen created");

			if (mode === "meeting" && !selection?.streamId) {
				throw new Error("No sharing source selected");
			}

			await setState("recording");
			startKeepalive();
			await sendToOffscreenWithRetry({
				type: "start-capture",
				mode,
				accessToken: tokens.accessToken,
				language,
				diarization,
				streamId: selection?.streamId,
				canRequestAudioTrack: selection?.canRequestAudioTrack,
			});
		} catch (err) {
			stopKeepalive();
			logError("bg:startRecording", err);
			const msg =
				err instanceof Error ? err.message : "Failed to start recording";
			if (msg === "No source selected") {
				await setState("idle");
			} else {
				await setState("error", msg);
			}
		}
	}

	async function stopRecording() {
		await setState("processing");
		await sendMessage({ type: "stop-capture" });
	}

	async function getFreshTokensForRecording() {
		const currentTokens = await getTokens();
		if (!currentTokens) {
			return null;
		}

		const refreshedTokens = await refreshTokens().catch(() => null);
		return refreshedTokens ?? currentTokens;
	}

	async function setState(state: RecordingState, error?: string) {
		currentState = state;
		await sendMessage({ type: "recording-state-changed", state, error });
		updateBadge(state);
	}

	function updateBadge(state: RecordingState) {
		switch (state) {
			case "recording":
				chrome.action.setBadgeText({ text: "●" });
				chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
				break;
			case "processing":
				chrome.action.setBadgeText({ text: "…" });
				chrome.action.setBadgeBackgroundColor({ color: "#eab308" });
				break;
			default:
				chrome.action.setBadgeText({ text: "" });
				break;
		}
	}

	async function ensureMicPermission(): Promise<void> {
		const { micGranted } = await chrome.storage.local.get("micGranted");
		if (micGranted) return;

		return new Promise((resolve, reject) => {
			chrome.tabs.create(
				{ url: chrome.runtime.getURL("/mic-permission.html") },
				(tab) => {
					if (!tab?.id) {
						reject(new Error("Failed to open microphone permission tab"));
						return;
					}

					const tabId = tab.id;
					const listener = (closedTabId: number) => {
						if (closedTabId === tabId) {
							chrome.tabs.onRemoved.removeListener(listener);
							chrome.storage.local.set({ micGranted: true });
							resolve();
						}
					};
					chrome.tabs.onRemoved.addListener(listener);
				},
			);
		});
	}

	async function createOffscreen() {
		const existing = await chrome.offscreen.hasDocument().catch(() => false);
		if (existing) return;

		await chrome.offscreen.createDocument({
			url: chrome.runtime.getURL("/offscreen.html"),
			reasons: [
				chrome.offscreen.Reason.USER_MEDIA,
				chrome.offscreen.Reason.DISPLAY_MEDIA,
				chrome.offscreen.Reason.AUDIO_PLAYBACK,
			],
			justification:
				"Audio capture (mic + desktop) and processing for transcription",
		});
	}

	async function sendToOffscreenWithRetry(
		message: Message,
		retries = 10,
		delayMs = 200,
	): Promise<void> {
		for (let i = 0; i < retries; i++) {
			try {
				await chrome.runtime.sendMessage(message);
				return;
			} catch {
				await new Promise((r) => setTimeout(r, delayMs));
			}
		}
		throw new Error("Failed to reach offscreen document");
	}

	async function closeOffscreen() {
		stopKeepalive();
		const existing = await chrome.offscreen.hasDocument().catch(() => false);
		if (existing) {
			await chrome.offscreen.closeDocument();
		}
	}
});
