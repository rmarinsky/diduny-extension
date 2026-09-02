import { expect, test } from "bun:test";
import { acquireRecordingLock } from "./recording-lock";

test("reports another recording instead of stealing an unavailable Web Lock", async () => {
	const release = await acquireRecordingLock({
		async request(_name, _options, callback) {
			return callback(null);
		},
	});

	expect(release).toBeNull();
});

test("keeps the lock until the caller releases it", async () => {
	let finished = false;
	const release = await acquireRecordingLock({
		async request(_name, _options, callback) {
			await callback({});
			finished = true;
		},
	});

	expect(release).toBeFunction();
	expect(finished).toBeFalse();
	release?.();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(finished).toBeTrue();
});
