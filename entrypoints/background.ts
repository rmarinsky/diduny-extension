import { getDefaultMicrophoneId } from "../lib/audio/microphone";
import { getTabCaptureStreamId } from "../lib/audio/tab-capture";
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
import {
	type CommandPress,
	nextCommandPress,
} from "../lib/commands/multi-press";
import { crashLog, getCrashLogs, logError } from "../lib/crash-log";
import {
	type DeliverySession,
	isDeliverySession,
	selectDeliverySession,
} from "../lib/delivery/delivery-session";
import {
	type DeliveryPreparation,
	deliverToQuill,
	installDeliveryBridge,
} from "../lib/delivery/page-bridge";
import { isDeliveryEnabled } from "../lib/delivery/site-settings";
import { onMessage, sendMessage } from "../lib/messaging/bridge";
import type { DictationTranslation, Message } from "../lib/messaging/types";
import type { RecordingMode, RecordingState } from "../lib/types";
import { INPUT_TIMING } from "../src/core/constants";

export default defineBackground(() => {
	let currentState: RecordingState = "idle";
	const completedSources = new Set<"mic" | "tab">();
	const persistedSources = new Set<"mic" | "tab">();
	const KEEPALIVE_ALARM = "recording-keepalive";
	const DELIVERY_SESSION_STORAGE_KEY = "didunyDeliverySession";
	let deliverySession: DeliverySession | undefined;
	let commandPress: CommandPress | undefined;
	let commandPressTimer: ReturnType<typeof setTimeout> | undefined;
	type DeliveryUnavailableReason = Exclude<
		Extract<Message, { type: "delivery-availability" }>["reason"],
		undefined
	>;

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
		if (currentState === "recording") {
			await stopRecording();
		} else if (
			currentState === "idle" ||
			currentState === "success" ||
			currentState === "error"
		) {
			if (command === "toggle-recording") {
				await handleDictationCommandPress();
			} else if (command === "toggle-translation") {
				await startRecording("translation", "uk", false, {
					targetLanguage: "en",
				});
			} else if (command === "start-meeting") {
				await startRecording("meeting", "uk", false);
			}
		}
	});

	async function handleDictationCommandPress() {
		const next = nextCommandPress(commandPress, Date.now());
		commandPress = next;
		if (commandPressTimer) clearTimeout(commandPressTimer);
		if (next.count >= 3) {
			commandPress = undefined;
			commandPressTimer = undefined;
			await startRecording("meeting", "uk", false);
			return;
		}
		// ponytail: this is input disambiguation before capture; audio rotation never uses a timer.
		commandPressTimer = setTimeout(() => {
			commandPress = undefined;
			commandPressTimer = undefined;
			if (
				currentState === "idle" ||
				currentState === "success" ||
				currentState === "error"
			)
				void startRecording("voice", "uk", false);
		}, INPUT_TIMING.multiPressWindowMs);
	}

	// ── Recording message routing ───────────────────────────────────────────────
	onMessage(async (msg) => {
		crashLog("bg:msg", "info", `received: ${msg.type}`);
		switch (msg.type) {
			case "start-recording": {
				await startRecording(
					msg.mode,
					msg.language,
					msg.diarization,
					msg.translation,
					msg.targetTabId,
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
		translation?: DictationTranslation,
		targetTabId?: number,
	) {
		crashLog(
			"bg:startRecording",
			"info",
			`mode=${mode}, lang=${language}, diarization=${diarization}`,
		);

		const [session, bffOrigin, microphoneDeviceId] = await Promise.all([
			getBffAuthSession(),
			getBffOrigin(),
			getDefaultMicrophoneId(),
		]);
		if (!session.authenticated) {
			await setState("error", "Not authenticated");
			return;
		}

		try {
			completedSources.clear();
			persistedSources.clear();
			await clearDeliveryStatus();
			const delivery =
				mode !== "meeting" ? await prepareDeliveryTarget() : undefined;
			await saveDeliverySession(delivery?.session);
			if (mode !== "meeting") {
				await sendMessage({
					type: "delivery-availability",
					available: Boolean(delivery?.session),
					reason: delivery?.reason,
				});
			}
			await ensureMicPermission();
			crashLog("bg:startRecording", "info", "mic permission OK");

			await createOffscreen();
			crashLog("bg:startRecording", "info", "offscreen created");

			const streamId =
				mode === "meeting"
					? await meetingTabCaptureStreamId(targetTabId)
					: undefined;

			await setState("starting");
			startKeepalive();
			await sendToOffscreenWithRetry({
				type: "start-capture",
				mode,
				bffOrigin,
				language,
				diarization,
				microphoneDeviceId,
				streamId,
				translation,
			});
		} catch (err) {
			stopKeepalive();
			await clearDeliveryStatus();
			logError("bg:startRecording", err);
			const msg =
				err instanceof Error ? err.message : "Failed to start recording";
			await setState("error", msg);
		}
	}

	async function stopRecording() {
		await setState("processing");
		await sendDeliveryStatus("processing");
		await sendMessage({ type: "stop-capture" });
	}

	async function meetingTabCaptureStreamId(targetTabId?: number) {
		if (targetTabId)
			return getTabCaptureStreamId(
				chrome.tabCapture,
				chrome.runtime,
				targetTabId,
			);
		const [tab] = await chrome.tabs.query({
			active: true,
			lastFocusedWindow: true,
		});
		if (!tab?.id) throw new Error("Could not find the active browser tab");
		return getTabCaptureStreamId(chrome.tabCapture, chrome.runtime, tab.id);
	}

	async function prepareDeliveryTarget(): Promise<{
		reason?: DeliveryUnavailableReason;
		session?: DeliverySession;
	}> {
		const [tab] = await chrome.tabs.query({
			active: true,
			lastFocusedWindow: true,
		});
		if (!tab?.id || !tab.url) return { reason: "no-text-field" };
		if (!(await isDeliveryEnabled(tab.url))) return { reason: "site-disabled" };

		try {
			const results = await chrome.scripting.executeScript({
				// ponytail: activeTab reaches permitted frames; add optional host access for third-party iframe inputs.
				target: { tabId: tab.id, allFrames: true },
				func: installDeliveryBridge,
			});
			const session = selectDeliverySession(tab.id, results);
			crashLog("bg:delivery", "info", `targetReady=${!!session}`);
			if (session) return { session };
			const unavailable = results
				.map((result) => result.result as DeliveryPreparation | undefined)
				.find((result) => result?.ready === false);
			return {
				reason:
					unavailable?.ready === false ? unavailable.reason : "no-text-field",
			};
		} catch (err) {
			crashLog(
				"bg:delivery",
				"warn",
				err instanceof Error
					? err.message
					: "Could not prepare delivery target",
			);
			return { reason: "permission-denied" };
		}
	}

	async function deliverTranscript(text: string) {
		const session = await getDeliverySession();
		if (!session) return;

		try {
			if (!(await isDeliveryEnabled(session.origin))) {
				await sendMessage({
					type: "delivery-availability",
					available: false,
					reason: "site-disabled",
				});
				return;
			}
			if (text) {
				let result =
					session.editor === "quill"
						? await deliverQuillTranscript(session, text)
						: undefined;
				if (result?.inserted !== true) {
					result = await chrome.tabs.sendMessage(
						session.tabId,
						{
							type: "diduny:deliver-transcript",
							text,
						},
						{ frameId: session.frameId },
					);
				}
				crashLog(
					"bg:delivery",
					"info",
					`inserted=${result?.inserted === true}`,
				);
				if (result?.inserted !== true)
					await sendMessage({
						type: "delivery-availability",
						available: false,
						reason: "target-unavailable",
					});
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

	async function deliverQuillTranscript(
		session: DeliverySession,
		text: string,
	) {
		try {
			const [result] = await chrome.scripting.executeScript({
				args: [text],
				func: deliverToQuill,
				target: { frameIds: [session.frameId], tabId: session.tabId },
				world: "MAIN",
			});
			return result?.result;
		} catch (error) {
			logError("bg:quill-delivery", error);
			return undefined;
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
				"Audio capture (microphone + browser tab) and processing for transcription",
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
