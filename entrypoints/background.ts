/**
 * Background service worker — single entry point per ADR-0005.
 *
 * Auth responsibilities:
 * - Calls the BFF's cookie-backed session endpoints.
 * - Responds to auth messages without retaining upstream credentials.
 *
 * Recording responsibilities:
 * - Manages offscreen document lifecycle.
 * - Routes recording messages between side panel and offscreen.
 * - Maintains badge state.
 */
import { getBffAuthSession, logoutBff } from "../lib/bff/auth";
import { getBffOrigin } from "../lib/bff/client";
import { crashLog, getCrashLogs, logError } from "../lib/crash-log";
import {
	type DeliverySession,
	isDeliverySession,
	selectDeliverySession,
} from "../lib/delivery/delivery-session";
import { installDeliveryBridge } from "../lib/delivery/page-bridge";
import { onMessage, sendMessage } from "../lib/messaging/bridge";
import type { Message } from "../lib/messaging/types";
import type { RecordingMode, RecordingState } from "../lib/types";

interface DesktopCaptureSelection {
	streamId: string;
	canRequestAudioTrack: boolean;
}

export default defineBackground(() => {
	let currentState: RecordingState = "idle";
	const completedSources = new Set<"mic" | "tab">();
	const persistedSources = new Set<"mic" | "tab">();
	const KEEPALIVE_ALARM = "recording-keepalive";
	const DELIVERY_SESSION_STORAGE_KEY = "didunyDeliverySession";
	let deliverySession: DeliverySession | undefined;

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

	// ── Auth message handler ────────────────────────────────────────────────────
	// The raw chrome.runtime API keeps the response channel open for BFF calls.
	chrome.runtime.onMessage.addListener(
		(msg: unknown, _sender, sendResponse) => {
			if (!msg || typeof msg !== "object" || !("type" in msg)) return false;
			const message = msg as { type: string; [k: string]: unknown };

			switch (message.type) {
				case "getBffSession": {
					getBffAuthSession()
						.then((session) => sendResponse(session))
						.catch(() => sendResponse({ authenticated: false }));
					return true;
				}

				case "openBffSignIn": {
					getBffOrigin()
						.then((origin) => chrome.tabs.create({ url: origin }))
						.then(() => sendResponse({ ok: true }))
						.catch((error) =>
							sendResponse({
								ok: false,
								error:
									error instanceof Error
										? error.message
										: "Unable to open Diduny",
							}),
						);
					return true;
				}

				case "signOutRequest": {
					logoutBff()
						.then(() => {
							sendMessage({ type: "forceClose" }).catch(() => {});
							sendResponse({ ok: true });
						})
						.catch((error) =>
							sendResponse({
								ok: false,
								error: error instanceof Error ? error.message : "Logout failed",
							}),
						);
					return true;
				}

				default:
					return false;
			}
		},
	);

	// ── Keyboard shortcut ───────────────────────────────────────────────────────
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

	// ── Recording message routing ───────────────────────────────────────────────
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
			case "capture-ready": {
				if (currentState === "starting") await setState("recording");
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
				await deliverTranscript(msg.text);
				await sendMessage({
					type: "transcription-complete",
					text: msg.text,
					source: msg.source,
				});
				completedSources.add(msg.source);
				if (persistedSources.has(msg.source)) {
					completedSources.delete(msg.source);
					persistedSources.delete(msg.source);
				}
				if (completedSources.size === 0) {
					await setState("success");
					await closeOffscreen();
				}
				break;
			}
			case "capture-persisted": {
				if (completedSources.has(msg.source)) {
					completedSources.delete(msg.source);
				} else {
					persistedSources.add(msg.source);
				}
				if (completedSources.size === 0 && persistedSources.size === 0) {
					await setState("success");
					await closeOffscreen();
				}
				break;
			}
			case "capture-error": {
				completedSources.clear();
				persistedSources.clear();
				await clearDeliveryStatus();
				await setState("error", msg.error);
				await closeOffscreen();
				break;
			}
		}
	});

	// ── Recording helpers ───────────────────────────────────────────────────────

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

		const [session, bffOrigin] = await Promise.all([
			getBffAuthSession(),
			getBffOrigin(),
		]);
		if (!session.authenticated) {
			await setState("error", "Not authenticated");
			return;
		}

		try {
			completedSources.clear();
			persistedSources.clear();
			await clearDeliveryStatus();
			await saveDeliverySession(
				mode === "voice" ? await prepareDeliveryTarget() : undefined,
			);
			await ensureMicPermission();
			crashLog("bg:startRecording", "info", "mic permission OK");

			await createOffscreen();
			crashLog("bg:startRecording", "info", "offscreen created");

			if (mode === "meeting" && !selection?.streamId) {
				throw new Error("No sharing source selected");
			}

			await setState("starting");
			startKeepalive();
			await sendToOffscreenWithRetry({
				type: "start-capture",
				mode,
				bffOrigin,
				language,
				diarization,
				streamId: selection?.streamId,
				canRequestAudioTrack: selection?.canRequestAudioTrack,
			});
		} catch (err) {
			stopKeepalive();
			await clearDeliveryStatus();
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
		await sendDeliveryStatus("processing");
		await sendMessage({ type: "stop-capture" });
	}

	async function prepareDeliveryTarget(): Promise<DeliverySession | undefined> {
		const [tab] = await chrome.tabs.query({
			active: true,
			lastFocusedWindow: true,
		});
		if (!tab?.id) return undefined;

		try {
			const results = await chrome.scripting.executeScript({
				// ponytail: activeTab reaches permitted frames; add optional host access for third-party iframe inputs.
				target: { tabId: tab.id, allFrames: true },
				func: installDeliveryBridge,
			});
			const session = selectDeliverySession(tab.id, results);
			crashLog("bg:delivery", "info", `targetReady=${!!session}`);
			return session;
		} catch (err) {
			crashLog(
				"bg:delivery",
				"warn",
				err instanceof Error
					? err.message
					: "Could not prepare delivery target",
			);
			return undefined;
		}
	}

	async function deliverTranscript(text: string) {
		const session = await getDeliverySession();
		if (!session) return;

		try {
			if (text) {
				const result = await chrome.tabs.sendMessage(
					session.tabId,
					{
						type: "diduny:deliver-transcript",
						text,
					},
					{ frameId: session.frameId },
				);
				crashLog(
					"bg:delivery",
					"info",
					`inserted=${result?.inserted === true}`,
				);
			}
		} catch (err) {
			crashLog(
				"bg:delivery",
				"warn",
				err instanceof Error ? err.message : "Could not deliver transcript",
			);
		} finally {
			await sendDeliveryStatus("clear", session);
			await clearDeliverySession();
		}
	}

	async function clearDeliveryStatus() {
		const session = await getDeliverySession();
		if (session) {
			await sendDeliveryStatus("clear", session);
		}
		await clearDeliverySession();
	}

	async function sendDeliveryStatus(
		status: "processing" | "clear",
		session?: DeliverySession,
	) {
		const target = session ?? (await getDeliverySession());
		if (!target) return;
		await chrome.tabs
			.sendMessage(
				target.tabId,
				{ type: "diduny:delivery-status", status },
				{ frameId: target.frameId },
			)
			.catch(() => {});
	}

	async function saveDeliverySession(session: DeliverySession | undefined) {
		deliverySession = session;
		try {
			if (session) {
				await chrome.storage.session.set({
					[DELIVERY_SESSION_STORAGE_KEY]: session,
				});
			} else {
				await chrome.storage.session.remove(DELIVERY_SESSION_STORAGE_KEY);
			}
		} catch (err) {
			logError("bg:delivery-session", err);
		}
	}

	async function getDeliverySession(): Promise<DeliverySession | undefined> {
		if (deliverySession) return deliverySession;

		try {
			const stored = await chrome.storage.session.get(
				DELIVERY_SESSION_STORAGE_KEY,
			);
			const session = stored[DELIVERY_SESSION_STORAGE_KEY];
			if (isDeliverySession(session)) {
				deliverySession = session;
				return session;
			}
		} catch (err) {
			logError("bg:delivery-session", err);
		}

		return undefined;
	}

	async function clearDeliverySession() {
		await saveDeliverySession(undefined);
	}

	async function setState(state: RecordingState, error?: string) {
		currentState = state;
		await sendMessage({ type: "recording-state-changed", state, error });
		updateBadge(state);
	}

	function updateBadge(state: RecordingState) {
		switch (state) {
			case "starting":
				chrome.action.setBadgeText({ text: "…" });
				chrome.action.setBadgeBackgroundColor({ color: "#eab308" });
				break;
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
