import { expect, test } from "bun:test";
import {
	CAPTURE_TERMINAL_STORAGE_KEY,
	createCaptureTerminalLifecycle,
} from "./capture-terminal-lifecycle";

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
		async get(key: string) {
			return values.has(key) ? { [key]: values.get(key) } : {};
		},
		async set(next: Record<string, unknown>) {
			for (const [key, value] of Object.entries(next)) values.set(key, value);
		},
	};
}

test("durably records an error, its cleanup intent, and a pending transcript", async () => {
	const values = new Map<string, unknown>();
	const baseStorage = storageArea(values);
	const errorWriteStarted = deferred<void>();
	const allowErrorWrite = deferred<void>();
	let blockErrorWrite = false;
	let writes = 0;
	const lifecycle = createCaptureTerminalLifecycle({
		...baseStorage,
		async set(next) {
			writes += 1;
			if (blockErrorWrite) {
				errorWriteStarted.resolve();
				await allowErrorWrite.promise;
			}
			await baseStorage.set(next);
		},
	});
	const capture = lifecycle.begin();
	await capture.ready;
	await lifecycle.captureComplete(capture.id, "mic", "Keep this transcript");

	blockErrorWrite = true;
	let acknowledged = false;
	const failure = lifecycle
		.captureFailed(capture.id, "Library save failed")
		.then((decision) => {
			acknowledged = true;
			return decision;
		});
	await errorWriteStarted.promise;
	expect(acknowledged).toBe(false);

	allowErrorWrite.resolve();
	expect(await failure).toMatchObject({
		accepted: true,
		captureId: capture.id,
		outcome: { error: "Library save failed", kind: "error" },
		shouldClose: false,
	});
	let cleanupCalls = 0;
	expect(
		await lifecycle.cleanup(capture.id, async () => {
			cleanupCalls += 1;
		}),
	).toMatchObject({
		accepted: true,
		captureId: capture.id,
		cleanupRequested: true,
		shouldClose: false,
	});
	expect(cleanupCalls).toBe(0);
	const writeCountAfterCleanupRequest = writes;

	expect(
		await lifecycle.captureFailed(capture.id, "A later error"),
	).toMatchObject({
		accepted: false,
		captureId: capture.id,
	});
	expect(
		await lifecycle.capturePersisted("stale-capture", "mic"),
	).toMatchObject({
		accepted: false,
		captureId: "stale-capture",
	});
	expect(writes).toBe(writeCountAfterCleanupRequest);

	const restartedLifecycle = createCaptureTerminalLifecycle(baseStorage);
	expect(await restartedLifecycle.resume()).toMatchObject({
		captureId: capture.id,
		cleanupRequested: true,
		outcome: { error: "Library save failed", kind: "error" },
		pendingDelivery: { source: "mic", text: "Keep this transcript" },
		shouldClose: false,
	});
	expect(values.get(CAPTURE_TERMINAL_STORAGE_KEY)).toMatchObject({
		cleanupRequested: true,
		outcome: { error: "Library save failed", kind: "error" },
		pendingDelivery: { source: "mic", text: "Keep this transcript" },
	});
	expect(
		await restartedLifecycle.deliveryFinished(capture.id, "mic"),
	).toMatchObject({
		accepted: true,
		captureId: capture.id,
		cleanupRequested: true,
		outcome: { error: "Library save failed", kind: "error" },
		shouldClose: true,
	});
	expect(
		await restartedLifecycle.cleanup(capture.id, async () => {
			cleanupCalls += 1;
		}),
	).toMatchObject({ accepted: true, captureId: capture.id });
	expect(
		await restartedLifecycle.cleanup(capture.id, async () => {
			cleanupCalls += 1;
		}),
	).toMatchObject({ accepted: false, captureId: capture.id });
	expect(cleanupCalls).toBe(1);
});

test("serializes terminal cleanup with a new capture so an old close cannot affect it", async () => {
	const lifecycle = createCaptureTerminalLifecycle(storageArea(new Map()));
	const previous = lifecycle.begin();
	await previous.ready;
	await lifecycle.captureFailed(previous.id, "Capture failed");

	const staleCloseStarted = deferred<void>();
	const allowStaleClose = deferred<void>();
	let staleCloseCalls = 0;
	let oldCleanupCalls = 0;
	const next = lifecycle.begin(async () => {
		staleCloseCalls += 1;
		staleCloseStarted.resolve();
		await allowStaleClose.promise;
	});
	await staleCloseStarted.promise;
	const oldCleanup = lifecycle.cleanup(previous.id, async () => {
		oldCleanupCalls += 1;
	});
	await Promise.resolve();
	expect(oldCleanupCalls).toBe(0);

	allowStaleClose.resolve();
	await next.ready;
	expect(await oldCleanup).toMatchObject({
		accepted: false,
		captureId: previous.id,
	});
	expect(staleCloseCalls).toBe(1);
	expect(oldCleanupCalls).toBe(0);
	expect(lifecycle.isCurrent(next.id)).toBe(true);

	await lifecycle.captureFailed(next.id, "New capture failed");
	let currentCleanupCalls = 0;
	expect(
		await lifecycle.cleanup(next.id, async () => {
			currentCleanupCalls += 1;
		}),
	).toMatchObject({ accepted: true, captureId: next.id });
	expect(
		await lifecycle.cleanup(next.id, async () => {
			currentCleanupCalls += 1;
		}),
	).toMatchObject({ accepted: false, captureId: next.id });
	expect(currentCleanupCalls).toBe(1);
});

test("does not replace a pending terminal delivery when a new capture begins", async () => {
	const lifecycle = createCaptureTerminalLifecycle(storageArea(new Map()));
	const previous = lifecycle.begin();
	await previous.ready;
	await lifecycle.captureComplete(
		previous.id,
		"mic",
		"Deliver before replacing",
	);
	await lifecycle.captureFailed(previous.id, "Library save failed");

	let staleCloseCalls = 0;
	const blocked = lifecycle.begin(async () => {
		staleCloseCalls += 1;
	});
	expect(await blocked.ready).toBe(false);
	expect(staleCloseCalls).toBe(0);
	expect(lifecycle.isCurrent(previous.id)).toBe(true);
	expect(await lifecycle.resume()).toMatchObject({
		captureId: previous.id,
		pendingDelivery: { source: "mic", text: "Deliver before replacing" },
	});

	await lifecycle.deliveryFinished(previous.id, "mic");
	const replacement = lifecycle.begin(async () => {
		staleCloseCalls += 1;
	});
	expect(await replacement.ready).toBe(true);
	expect(staleCloseCalls).toBe(1);
	expect(lifecycle.isCurrent(replacement.id)).toBe(true);
});

test("replaces an orphaned nonterminal capture when no transcript delivery is pending", async () => {
	const lifecycle = createCaptureTerminalLifecycle(storageArea(new Map()));
	const orphaned = lifecycle.begin();
	await orphaned.ready;

	let staleCloseCalls = 0;
	const replacement = lifecycle.begin(async () => {
		staleCloseCalls += 1;
	});
	expect(await replacement.ready).toBe(true);
	expect(staleCloseCalls).toBe(0);
	expect(lifecycle.isCurrent(replacement.id)).toBe(true);
	expect(await lifecycle.resume()).toMatchObject({
		captureId: replacement.id,
		shouldClose: false,
	});
});
