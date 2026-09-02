import { afterEach, expect, test } from "bun:test";
import { createCaptureTerminalLifecycle } from "../lib/recording/capture-terminal-lifecycle";

type Deferred<T> = {
	promise: Promise<T>;
	reject: (reason?: unknown) => void;
	resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
	let reject!: (reason?: unknown) => void;
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

function storageArea(values: Map<string, unknown>) {
	return {
		async get(keys?: string | string[] | null) {
			const requested =
				keys === null || keys === undefined
					? [...values.keys()]
					: Array.isArray(keys)
						? keys
						: [keys];
			return Object.fromEntries(
				requested.flatMap((key) =>
					values.has(key) ? [[key, values.get(key)]] : [],
				),
			);
		},
		async remove(keys: string | string[]) {
			for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
		},
		async set(next: Record<string, unknown>) {
			for (const [key, value] of Object.entries(next)) values.set(key, value);
		},
	};
}

test("finishes a completed capture after the service worker restarts before persistence arrives", async () => {
	const session = new Map<string, unknown>();
	const firstWorker = createCaptureTerminalLifecycle(storageArea(session));
	const capture = firstWorker.begin();
	await capture.ready;

	expect(
		(await firstWorker.captureComplete("mic", "Retry this transcript"))
			.shouldClose,
	).toBe(false);
	expect(
		(await firstWorker.deliveryFinished(capture.id, "mic")).shouldClose,
	).toBe(false);

	const restartedWorker = createCaptureTerminalLifecycle(storageArea(session));
	expect((await restartedWorker.capturePersisted("mic")).shouldClose).toBe(
		true,
	);
});

test("finishes a persisted capture after the service worker restarts before completion arrives", async () => {
	const session = new Map<string, unknown>();
	const firstWorker = createCaptureTerminalLifecycle(storageArea(session));
	const capture = firstWorker.begin();
	await capture.ready;

	expect((await firstWorker.capturePersisted("tab")).shouldClose).toBe(false);

	const restartedWorker = createCaptureTerminalLifecycle(storageArea(session));
	const completion = await restartedWorker.captureComplete(
		"tab",
		"Persist this transcript",
	);
	expect(completion.shouldClose).toBe(false);
	expect(
		(await restartedWorker.deliveryFinished(completion.captureId, "tab"))
			.shouldClose,
	).toBe(true);
});

test("restores an unfinished transcript delivery after the service worker restarts", async () => {
	const session = new Map<string, unknown>();
	const firstWorker = createCaptureTerminalLifecycle(storageArea(session));
	const capture = firstWorker.begin();
	await capture.ready;
	await firstWorker.captureComplete("mic", "Retry after restart");

	const restartedWorker = createCaptureTerminalLifecycle(storageArea(session));
	expect(await restartedWorker.resume()).toMatchObject({
		captureId: capture.id,
		pendingDelivery: { source: "mic", text: "Retry after restart" },
		shouldClose: false,
	});
});

test("does not let queued recovery overwrite a newer capture", async () => {
	const recoveryRead = deferred<void>();
	const session = new Map<string, unknown>([
		[
			"didunyCaptureTerminalState",
			{
				captureId: "older-capture",
				completedSources: ["mic"],
				deliveredSources: ["mic"],
				persistedSources: ["mic"],
				terminal: true,
			},
		],
	]);
	const baseStorage = storageArea(session);
	const lifecycle = createCaptureTerminalLifecycle({
		...baseStorage,
		async get(key) {
			await recoveryRead.promise;
			return baseStorage.get(key);
		},
	});

	const recovery = lifecycle.resume();
	const newerCapture = lifecycle.begin();
	recoveryRead.resolve();
	await recovery;
	await newerCapture.ready;

	expect(lifecycle.isCurrent(newerCapture.id)).toBe(true);
	expect(session.get("didunyCaptureTerminalState")).toMatchObject({
		captureId: newerCapture.id,
		terminal: false,
	});
});

async function waitFor(predicate: () => boolean, message: string) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error(`Timed out waiting for ${message}`);
}

const globals = globalThis as typeof globalThis & {
	defineBackground?: (entrypoint: () => void) => void;
};
const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
const originalDefineBackground = Object.getOwnPropertyDescriptor(
	globalThis,
	"defineBackground",
);
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");

afterEach(() => {
	for (const [key, descriptor] of [
		["chrome", originalChrome],
		["defineBackground", originalDefineBackground],
		["fetch", originalFetch],
		["self", originalSelf],
	] as const) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete (globalThis as Record<string, unknown>)[key];
	}
});

function createBackgroundHarness({
	delayTranscriptDelivery = false,
	recoverPendingDelivery = false,
}: {
	delayTranscriptDelivery?: boolean;
	recoverPendingDelivery?: boolean;
} = {}) {
	const local = new Map<string, unknown>([["micGranted", true]]);
	const session = new Map<string, unknown>();
	if (delayTranscriptDelivery || recoverPendingDelivery) {
		session.set("didunyDeliverySession", {
			frameId: 0,
			origin: "https://target.test",
			tabId: 1,
		});
	}
	if (recoverPendingDelivery) {
		session.set("didunyCaptureTerminalState", {
			captureId: "older-capture",
			completedSources: ["mic"],
			deliveredSources: [],
			pendingDelivery: {
				source: "mic",
				text: "Older transcript",
			},
			persistedSources: ["mic"],
			terminal: false,
		});
	}
	const runtimeListeners: Array<
		(
			message: unknown,
			sender: chrome.runtime.MessageSender,
			response: (value?: unknown) => void,
		) => boolean | undefined
	> = [];
	const backgroundMessages: Array<{ type?: string }> = [];
	const transcriptDeliveryMessages: Array<{
		deliveryId?: unknown;
		text?: unknown;
		type?: string;
	}> = [];
	const transcriptDelivery = deferred<{ inserted: boolean }>();
	const startupRecovery = deferred<void>();
	if (!recoverPendingDelivery) startupRecovery.resolve();
	let transcriptDeliveryCalls = 0;
	let closeDocumentCalls = 0;
	let createDocumentCalls = 0;
	let offscreenExists = true;
	const baseSessionStorage = storageArea(session);

	const chromeMock = {
		action: {
			setBadgeBackgroundColor() {},
			setBadgeText() {},
		},
		alarms: {
			clear() {},
			create() {},
			onAlarm: { addListener() {} },
		},
		commands: { onCommand: { addListener() {} } },
		offscreen: {
			Reason: {
				AUDIO_PLAYBACK: "AUDIO_PLAYBACK",
				DISPLAY_MEDIA: "DISPLAY_MEDIA",
				USER_MEDIA: "USER_MEDIA",
			},
			async closeDocument() {
				closeDocumentCalls += 1;
				offscreenExists = false;
			},
			async createDocument() {
				createDocumentCalls += 1;
				offscreenExists = true;
			},
			async hasDocument() {
				return offscreenExists;
			},
		},
		permissions: { contains: async () => true, remove: async () => true },
		runtime: {
			getURL: (path: string) => `chrome-extension://diduny${path}`,
			onMessage: {
				addListener(listener: (typeof runtimeListeners)[number]) {
					runtimeListeners.push(listener);
				},
			},
			sendMessage: async (message: { type?: string }) => {
				backgroundMessages.push(message);
			},
		},
		scripting: {
			async executeScript() {
				return [
					{
						frameId: 0,
						result: { origin: "https://target.test", ready: true },
					},
				];
			},
		},
		sidePanel: { setPanelBehavior() {} },
		storage: {
			local: storageArea(local),
			session: {
				...baseSessionStorage,
				async get(key: string | string[] | null) {
					if (key === "didunyCaptureTerminalState")
						await startupRecovery.promise;
					return baseSessionStorage.get(key);
				},
			},
		},
		tabCapture: { getMediaStreamId() {} },
		tabs: {
			async query() {
				return [{ id: 1, url: "https://target.test/editor" }];
			},
			onRemoved: { addListener() {}, removeListener() {} },
			async sendMessage(
				_tabId: number,
				message: { deliveryId?: unknown; text?: unknown; type?: string },
			) {
				if (message.type !== "diduny:deliver-transcript") return;
				transcriptDeliveryMessages.push(message);
				transcriptDeliveryCalls += 1;
				return delayTranscriptDelivery
					? transcriptDelivery.promise
					: { inserted: true };
			},
		},
	} as unknown as typeof chrome;

	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		value: chromeMock,
		writable: true,
	});
	Object.defineProperty(globalThis, "self", {
		configurable: true,
		value: { addEventListener() {} },
		writable: true,
	});
	Object.defineProperty(globalThis, "defineBackground", {
		configurable: true,
		value: (entrypoint: () => void) => entrypoint(),
		writable: true,
	});
	Object.defineProperty(globalThis, "fetch", {
		configurable: true,
		value: async () =>
			Response.json({ authenticated: true, email: "person@example.com" }),
		writable: true,
	});

	return {
		backgroundMessages,
		closeDocumentCalls: () => closeDocumentCalls,
		createDocumentCalls: () => createDocumentCalls,
		deliverySession: () => session.get("didunyDeliverySession"),
		dispatch(message: unknown) {
			return runtimeListeners.map((listener) =>
				listener(message, {}, () => undefined),
			);
		},
		async request(message: unknown) {
			const replies: unknown[] = [];
			for (const listener of runtimeListeners)
				listener(message, {}, (value) => replies.push(value));
			await waitFor(
				() =>
					replies.some(
						(reply) =>
							typeof reply === "object" &&
							reply !== null &&
							"authenticated" in reply,
					),
				"the BFF session response",
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
			return replies;
		},
		async loadWorker() {
			await import("../entrypoints/background");
		},
		releaseStartupRecovery() {
			startupRecovery.resolve();
		},
		transcriptDelivery,
		transcriptDeliveryCalls: () => transcriptDeliveryCalls,
		transcriptDeliveryMessages,
	};
}

test("recovers delivery before accepting a new capture after worker restart", async () => {
	const harness = createBackgroundHarness({
		delayTranscriptDelivery: true,
		recoverPendingDelivery: true,
	});
	await harness.loadWorker();
	expect(await harness.request({ type: "getBffSession" })).toEqual([
		{ authenticated: true, email: "person@example.com" },
	]);
	const listenerResults = harness.dispatch({
		diarization: false,
		language: "uk",
		mode: "voice",
		type: "start-recording",
	});
	expect(listenerResults).toContain(true);
	expect(
		harness.backgroundMessages.some(
			(message) => message.type === "start-capture",
		),
	).toBe(false);

	harness.releaseStartupRecovery();
	await waitFor(
		() =>
			harness.transcriptDeliveryCalls() === 1 ||
			harness.backgroundMessages.some(
				(message) => message.type === "start-capture",
			),
		"recovery delivery or an incorrect new capture",
	);
	expect(harness.transcriptDeliveryCalls()).toBe(1);
	expect(harness.transcriptDeliveryMessages).toEqual([
		{
			deliveryId: "older-capture",
			text: "Older transcript",
			type: "diduny:deliver-transcript",
		},
	]);
	expect(
		harness.backgroundMessages.some(
			(message) => message.type === "start-capture",
		),
	).toBe(false);
	expect(harness.closeDocumentCalls()).toBe(0);

	harness.transcriptDelivery.resolve({ inserted: true });
	await waitFor(
		() => harness.closeDocumentCalls() === 1,
		"the recovered capture to finish after transcript delivery",
	);
	harness.dispatch({
		diarization: false,
		language: "uk",
		mode: "voice",
		type: "start-recording",
	});
	await waitFor(
		() =>
			harness.createDocumentCalls() === 1 &&
			harness.backgroundMessages.filter(
				(message) => message.type === "start-capture",
			).length === 1,
		"the new capture to start after recovery",
	);
	await waitFor(
		() =>
			harness.backgroundMessages.some(
				(message) => message.type === "transcription-complete",
			),
		"the older transcript delivery to complete",
	);
	expect(harness.closeDocumentCalls()).toBe(1);
	expect(harness.deliverySession()).toBeDefined();
});
