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

test("durably records an error before its acknowledgement and retains a pending transcript", async () => {
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
	).toMatchObject({ accepted: false, captureId: capture.id });
	expect(cleanupCalls).toBe(0);
	const writeCountAfterFailure = writes;

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
	expect(writes).toBe(writeCountAfterFailure);

	const restartedLifecycle = createCaptureTerminalLifecycle(baseStorage);
	expect(await restartedLifecycle.resume()).toMatchObject({
		captureId: capture.id,
		outcome: { error: "Library save failed", kind: "error" },
		pendingDelivery: { source: "mic", text: "Keep this transcript" },
		shouldClose: false,
	});
	expect(values.get(CAPTURE_TERMINAL_STORAGE_KEY)).toMatchObject({
		outcome: { error: "Library save failed", kind: "error" },
		pendingDelivery: { source: "mic", text: "Keep this transcript" },
	});
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
