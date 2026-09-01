/**
 * Background service worker — single entry point per ADR-0005.
 *
 * Auth responsibilities (ADR-0005):
 * - Holds the sole Supabase client instance (with chrome.storage.local adapter).
 * - Responds to auth messages: signInRequest, verifyOtpRequest, signOutRequest.
 * - Responds to getAccessToken from offscreen document (async sendMessage pattern).
 *
 * Recording responsibilities:
 * - Manages offscreen document lifecycle.
 * - Routes recording messages between side panel and offscreen.
 * - Maintains badge state.
 */
import { supabase } from "../lib/auth/supabaseClient";
import type { TokenResult } from "../lib/auth/tokenBridge";
import { crashLog, getCrashLogs, logError } from "../lib/crash-log";
import {
	type DeliveryPreparation,
	installDeliveryBridge,
} from "../lib/delivery/page-bridge";
import { onMessage, sendMessage } from "../lib/messaging/bridge";
import type { Message } from "../lib/messaging/types";
import type { RecordingMode, RecordingState } from "../lib/types";

interface DesktopCaptureSelection {
	streamId: string;
	canRequestAudioTrack: boolean;
}

interface DeliverySession {
	tabId: number;
	ready: boolean;
}

export default defineBackground(() => {
	let currentState: RecordingState = "idle";
	const completedSources = new Set<string>();
	const KEEPALIVE_ALARM = "recording-keepalive";
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

	// ── Auth message handler (per ADR-0005) ────────────────────────────────────
	//
	// Uses the raw chrome.runtime.onMessage API (not the typed bridge) because:
	// 1. getAccessToken requires sendResponse (async, return true pattern).
	// 2. Auth messages return data back to caller, unlike recording messages.
	chrome.runtime.onMessage.addListener(
		(msg: unknown, _sender, sendResponse) => {
			if (!msg || typeof msg !== "object" || !("type" in msg)) return false;
			const message = msg as { type: string; [k: string]: unknown };

			switch (message.type) {
				case "getAccessToken": {
					// Per ADR-0005: return true to keep channel open, respond async.
					// SW may have been suspended; SDK reads session from chrome.storage.local.
					supabase.auth.getSession().then(({ data, error }) => {
						if (error || !data.session) {
							sendResponse({
								error: "NOT_AUTHENTICATED",
							} satisfies TokenResult);
							return;
						}

						const session = data.session;
						const now = Math.floor(Date.now() / 1000);

						// If token is expired, attempt refresh before responding
						if (session.expires_at !== undefined && session.expires_at < now) {
							supabase.auth
								.refreshSession()
								.then(({ data: refreshed, error: refreshError }) => {
									if (refreshError || !refreshed.session) {
										sendResponse({
											error: "SESSION_EXPIRED",
										} satisfies TokenResult);
									} else {
										sendResponse({
											token: refreshed.session.access_token,
											expires_at: refreshed.session.expires_at ?? 0,
										} satisfies TokenResult);
									}
								})
								.catch(() => {
									sendResponse({
										error: "STORAGE_READ_FAILED",
									} satisfies TokenResult);
								});
						} else {
							sendResponse({
								token: session.access_token,
								expires_at: session.expires_at ?? 0,
							} satisfies TokenResult);
						}
					});
					return true; // keep channel open for async sendResponse
				}

				case "signInRequest": {
					const email = message.email as string;
					supabase.auth
						.signInWithOtp({ email })
						.then(({ error }) => {
							if (error) {
								sendResponse({ ok: false, error: error.message });
							} else {
								sendResponse({ ok: true });
							}
						})
						.catch((err) => {
							sendResponse({
								ok: false,
								error: err instanceof Error ? err.message : "Unknown error",
							});
						});
					return true;
				}

				case "verifyOtpRequest": {
					const email = message.email as string;
					const token = message.token as string;
					supabase.auth
						.verifyOtp({ email, token, type: "email" })
						.then(({ data, error }) => {
							if (error || !data.session) {
								sendResponse({
									ok: false,
									error: error?.message ?? "Verification failed",
								});
							} else {
								sendResponse({
									ok: true,
									user: data.session.user,
								});
							}
						})
						.catch((err) => {
							sendResponse({
								ok: false,
								error: err instanceof Error ? err.message : "Unknown error",
							});
						});
					return true;
				}

				case "getSessionUser": {
					// Returns the current Supabase user without exposing tokens.
					supabase.auth.getUser().then(({ data, error }) => {
						if (error || !data.user) {
							sendResponse({ ok: false });
						} else {
							sendResponse({
								ok: true,
								user: { id: data.user.id, email: data.user.email },
							});
						}
					});
					return true;
				}

				case "signOutRequest": {
					supabase.auth
						.signOut()
						.then(() => {
							// Per ADR-0005: broadcast forceClose to offscreen so it can flush
							// partial transcript and close WS cleanly.
							sendMessage({ type: "forceClose" }).catch(() => {});
							sendResponse({ ok: true });
						})
						.catch((err) => {
							sendResponse({
								ok: false,
								error: err instanceof Error ? err.message : "Unknown error",
							});
						});
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
				if (completedSources.size >= 1) {
					await setState("success");
					await closeOffscreen();
					completedSources.clear();
				}
				break;
			}
			case "capture-error": {
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

		// Per ADR-0005: get access token from Supabase SDK (reads chrome.storage.local)
		const { data: sessionData } = await supabase.auth.getSession();
		if (!sessionData.session) {
			await setState("error", "Not authenticated");
			return;
		}
		const accessToken = sessionData.session.access_token;

		try {
			deliverySession =
				mode === "voice" ? await prepareDeliveryTarget() : undefined;
			await ensureMicPermission();
			crashLog("bg:startRecording", "info", "mic permission OK");

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
				accessToken,
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
				target: { tabId: tab.id },
				func: installDeliveryBridge,
			});
			const preparation = results[0]?.result as DeliveryPreparation | undefined;
			const ready = preparation?.ready === true;
			crashLog("bg:delivery", "info", `targetReady=${ready}`);
			return { tabId: tab.id, ready };
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
		const session = deliverySession;
		deliverySession = undefined;
		if (!session) return;

		try {
			if (session.ready && text) {
				const result = (await chrome.tabs.sendMessage(session.tabId, {
					type: "diduny:deliver-transcript",
					text,
				})) as { inserted?: boolean } | undefined;
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
		}
	}

	async function clearDeliveryStatus() {
		const session = deliverySession;
		deliverySession = undefined;
		if (session) {
			await sendDeliveryStatus("clear", session);
		}
	}

	async function sendDeliveryStatus(
		status: "processing" | "clear",
		session = deliverySession,
	) {
		if (!session) return;
		await chrome.tabs
			.sendMessage(session.tabId, { type: "diduny:delivery-status", status })
			.catch(() => {});
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
