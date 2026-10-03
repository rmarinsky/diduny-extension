import {
	MIC_GRANTED_STORAGE_KEY,
	getDefaultMicrophoneId,
} from "../lib/audio/microphone";
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
	type RecordingRequest,
	commandRecording,
} from "../lib/commands/command-recording";
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
import {
	deliveryOrigin,
	isDeliveryEnabled,
} from "../lib/delivery/site-settings";
import { onMessage, sendMessage } from "../lib/messaging/bridge";
import type { Message } from "../lib/messaging/types";
import {
	SAME_TRANSLATION_LANGUAGE_MESSAGE,
	getRecordingPreferences,
} from "../lib/recording-preferences";
import type { RecordingMode, RecordingState } from "../lib/types";
import { INPUT_TIMING } from "../src/core/constants";
import { EXTENSION_DICTATION_EVENT } from "../web/src/dictation";

export default defineBackground(() => {
	let currentState: RecordingState = "idle";
	let currentMode: RecordingMode = "voice";
	/** Set from the first start until it records or fails, so a second start cannot replace it. */
	let startInFlight = false;
	/** Bumped when a recording is discarded, so a start still waiting for the microphone gives up. */
	let startGeneration = 0;
	let micPermissionTabId: number | undefined;
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

	// The toolbar button opens the side panel. Chrome grants activeTab, which
	// tab capture needs, only when the extension handles the click itself; with
	// openPanelOnActionClick the panel opened but Meeting could never record.
	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
	chrome.action.onClicked.addListener((tab) => {
		// Called straight from the click, as sidePanel.open needs a user gesture.
		chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => {
			logError("bg:openSidePanel", error);
		});
	});

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

	// Older versions kept up to 50 copies of every panel transcript here, and
	// nothing ever read them; the panel now keeps one draft in session storage.
	chrome.storage.local.remove("diduny_transcripts").catch(() => {});

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

				// A reopened side panel shows the recording that is still running.
				case "getRecordingState": {
					sendResponse({ mode: currentMode, state: currentState });
					return false;
				}

				case "signOutRequest": {
					// Logout ends the recording too; otherwise the panel comes back to a
					// capture that no longer exists and stays on Processing.
					discardRecording()
						.then(() => logoutBff())
						.then(() => sendResponse({ ok: true }))
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
			return;
		}
		if (command === "toggle-recording" && (await forwardDictationToWebApp()))
			return;
		if (!canStart()) return;
		if (command === "toggle-recording") {
			await handleDictationCommandPress();
		} else if (command === "toggle-translation") {
			await startRecording(
				commandRecording("translation", await getRecordingPreferences()),
			);
		} else if (command === "start-meeting") {
			await startRecording(
				commandRecording("meeting", await getRecordingPreferences()),
			);
		}
	});

	function canStart() {
		return (
			!startInFlight &&
			(currentState === "idle" ||
				currentState === "success" ||
				currentState === "error")
		);
	}

	/**
	 * Chrome gives Alt+Shift+V to the extension on every tab, so the Diduny web
	 * app never sees the key. On its tab, hand the press back to the page.
	 */
	async function forwardDictationToWebApp() {
		const [tab] = await chrome.tabs.query({
			active: true,
			lastFocusedWindow: true,
		});
		if (!tab?.id || !tab.url) return false;
		if (new URL(tab.url).origin !== (await getBffOrigin())) return false;
		try {
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: (eventName: string) => window.dispatchEvent(new Event(eventName)),
				args: [EXTENSION_DICTATION_EVENT],
			});
			return true;
		} catch (err) {
			logError("bg:forwardDictation", err);
			return false;
		}
	}

	async function handleDictationCommandPress() {
		const next = nextCommandPress(commandPress, Date.now());
		commandPress = next;
		if (commandPressTimer) clearTimeout(commandPressTimer);
		if (next.count >= 3) {
			commandPress = undefined;
			commandPressTimer = undefined;
			await startRecording(
				commandRecording("meeting", await getRecordingPreferences()),
			);
			return;
		}
		// ponytail: this is input disambiguation before capture; audio rotation never uses a timer.
		commandPressTimer = setTimeout(() => {
			commandPress = undefined;
			commandPressTimer = undefined;
			if (canStart())
				void getRecordingPreferences().then((preferences) =>
					startRecording(commandRecording("voice", preferences)),
				);
		}, INPUT_TIMING.multiPressWindowMs);
	}

	// ── Recording message routing ───────────────────────────────────────────────
	onMessage(async (msg) => {
		crashLog("bg:msg", "info", `received: ${msg.type}`);
		switch (msg.type) {
			case "start-recording": {
				await startRecording({
					diarization: msg.diarization,
					language: msg.language,
					mode: msg.mode,
					targetTabId: msg.targetTabId,
					translation: msg.translation,
				});
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
				// The stored grant was stale; the next record click reopens the permission page.
				if (msg.reason === "microphone-blocked")
					await chrome.storage.local.remove(MIC_GRANTED_STORAGE_KEY);
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

	async function startRecording({
		diarization,
		language,
		mode,
		targetTabId,
		translation,
	}: RecordingRequest) {
		if (!canStart()) {
			// A second click or shortcut must not restart the capture or replace
			// the field chosen at the first start; show the waiting page instead.
			crashLog("bg:startIgnored", "info", `state=${currentState}`);
			await focusMicPermissionTab();
			return;
		}
		crashLog(
			"bg:startRecording",
			"info",
			`mode=${mode}, lang=${language}, diarization=${diarization}`,
		);
		if (translation && translation.targetLanguage === language) {
			await setState("error", SAME_TRANSLATION_LANGUAGE_MESSAGE);
			return;
		}

		startInFlight = true;
		const generation = startGeneration;
		try {
			const [session, bffOrigin, microphoneDeviceId] = await Promise.all([
				getBffAuthSession(),
				getBffOrigin(),
				getDefaultMicrophoneId(),
			]);
			if (!session.authenticated) {
				// The web sign-out also ended this session; the panel offers sign-in again.
				await sendMessage({ type: "session-ended" });
				await setState("idle");
				return;
			}

			completedSources.clear();
			persistedSources.clear();
			await clearDeliveryStatus();
			const delivery =
				mode !== "meeting" ? await prepareDeliveryTarget(bffOrigin) : undefined;
			await saveDeliverySession(delivery?.session);
			if (mode !== "meeting") {
				await sendMessage({
					type: "delivery-availability",
					available: Boolean(delivery?.session),
					reason: delivery?.reason,
				});
			}
			currentMode = mode;
			await setState("starting");
			await ensureMicPermission();
			crashLog("bg:startRecording", "info", "mic permission OK");
			if (generation !== startGeneration) return;

			await createOffscreen();
			crashLog("bg:startRecording", "info", "offscreen created");

			const streamId =
				mode === "meeting"
					? await meetingTabCaptureStreamId(targetTabId)
					: undefined;

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
			// Logout discarded this start while it waited; it already reset the state.
			if (generation !== startGeneration) return;
			await clearDeliveryStatus();
			logError("bg:startRecording", err);
			const msg =
				err instanceof Error ? err.message : "Failed to start recording";
			await setState("error", msg);
			await closeOffscreen();
		} finally {
			startInFlight = false;
		}
	}

	async function stopRecording() {
		if (!(await chrome.offscreen.hasDocument().catch(() => false))) {
			// Nothing is capturing any more, so there is no result to wait for.
			stopKeepalive();
			await clearDeliveryStatus();
			await setState("idle");
			return;
		}
		await setState("processing");
		await sendDeliveryStatus("processing");
		await sendMessage({ type: "stop-capture" });
	}

	/** Ends a running or starting recording without a result, e.g. on Logout. */
	async function discardRecording() {
		startGeneration += 1;
		const capturing = await chrome.offscreen.hasDocument().catch(() => false);
		if (!capturing && currentState !== "starting") return;
		completedSources.clear();
		persistedSources.clear();
		if (micPermissionTabId !== undefined)
			await chrome.tabs.remove(micPermissionTabId).catch(() => {});
		// The offscreen document answers once its capture and scratch audio are gone.
		if (capturing)
			await chrome.runtime
				.sendMessage({ type: "forceClose" } satisfies Message)
				.catch(() => {});
		await clearDeliveryStatus();
		await closeOffscreen();
		await setState("idle");
	}

	async function meetingTabCaptureStreamId(targetTabId?: number) {
		const tab = targetTabId
			? await chrome.tabs.get(targetTabId).catch(() => undefined)
			: (
					await chrome.tabs.query({
						active: true,
						lastFocusedWindow: true,
					})
				)[0];
		const tabId = targetTabId ?? tab?.id;
		if (!tabId) throw new Error("Could not find the active browser tab");
		return getTabCaptureStreamId(
			chrome.tabCapture,
			chrome.runtime,
			tabId,
			tab?.url,
		);
	}

	async function prepareDeliveryTarget(bffOrigin: string): Promise<{
		reason?: DeliveryUnavailableReason;
		session?: DeliverySession;
	}> {
		const [tab] = await chrome.tabs.query({
			active: true,
			lastFocusedWindow: true,
		});
		if (!tab?.id || !tab.url) return { reason: "no-text-field" };
		// New Tab, about:blank and extension pages are not sites the user can disable.
		if (!deliveryOrigin(tab.url)) return { reason: "browser-page" };
		// Deliberately not synced: the Diduny web app keeps its own dictation
		// document. Typing the extension's result into it mixed two transcripts
		// (the panel shows live text, the page got the final upload), so on the
		// web app's origin the text stays in the side panel only.
		if (new URL(tab.url).origin === bffOrigin)
			return { reason: "diduny-web-app" };
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
						deliveryTarget(session),
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
			// The page navigated or closed, so its field is gone; say so instead of a bare Done.
			await sendMessage({
				type: "delivery-availability",
				available: false,
				reason: "target-unavailable",
			});
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
				deliveryTarget(target),
			)
			.catch(() => {});
	}

	/** Messages go to the document the field was in, never to a page that replaced it. */
	function deliveryTarget(session: DeliverySession) {
		return session.documentId
			? { documentId: session.documentId }
			: { frameId: session.frameId };
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
		await sendMessage({
			type: "recording-state-changed",
			state,
			error,
			mode: currentMode,
		});
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
		const granted = async () =>
			Boolean(
				(await chrome.storage.local.get(MIC_GRANTED_STORAGE_KEY))[
					MIC_GRANTED_STORAGE_KEY
				],
			);
		if (await granted()) return;

		await sendMessage({ type: "microphone-permission", status: "waiting" });
		return new Promise((resolve, reject) => {
			chrome.tabs.create(
				{ url: chrome.runtime.getURL("/mic-permission.html") },
				(tab) => {
					if (!tab?.id) {
						reject(new Error("Failed to open microphone permission tab"));
						return;
					}

					const tabId = tab.id;
					micPermissionTabId = tabId;
					// The page records the grant itself; closing it proves nothing.
					const listener = (closedTabId: number) => {
						if (closedTabId !== tabId) return;
						chrome.tabs.onRemoved.removeListener(listener);
						if (micPermissionTabId === tabId) micPermissionTabId = undefined;
						granted().then((ok) => {
							if (ok) resolve();
							else
								reject(
									new Error(
										"Microphone access was not granted. Click record to try again.",
									),
								);
						}, reject);
					};
					chrome.tabs.onRemoved.addListener(listener);
				},
			);
		});
	}

	async function focusMicPermissionTab() {
		if (micPermissionTabId === undefined) return;
		const tab = await chrome.tabs
			.update(micPermissionTabId, { active: true })
			.catch(() => undefined);
		if (tab?.windowId !== undefined)
			await chrome.windows
				.update(tab.windowId, { focused: true })
				.catch(() => undefined);
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
