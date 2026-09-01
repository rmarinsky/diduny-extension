import { expect, test } from "bun:test";
import { SessionMachine } from "../src/core";

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function dependencies(events, finalize) {
	return {
		audio: {
			cancel() {},
			async start() {
				events.push("audio.start");
			},
			async stop() {
				events.push("audio.stop");
				return new Uint8Array([1]);
			},
		},
		async cleanup(text) {
			events.push(`cleanup:${text}`);
		},
		deliver(text) {
			events.push(`deliver:${text}`);
		},
		finalize,
		async refreshUsage() {
			events.push("usage.refresh");
		},
		async save(result) {
			events.push(`save:${result.text}`);
		},
		async updateStored(result) {
			events.push(`update:${result.text}`);
		},
	};
}

test("starts finalize before capture stops and keeps post-delivery work below the cut line", async () => {
	const events = [];
	const finalizeGate = deferred();
	const machine = new SessionMachine(
		dependencies(events, async () => {
			events.push("finalize");
			return finalizeGate.promise;
		}),
	);

	await machine.start();
	const stopping = machine.stop();
	await Promise.resolve();
	expect(events).toEqual(["audio.start", "finalize", "audio.stop"]);

	finalizeGate.resolve("first text");
	await stopping;
	await machine.waitForBackground();
	expect(events).toContain("deliver:first text");
	expect(events.slice(4).sort()).toEqual([
		"cleanup:first text",
		"save:first text",
		"usage.refresh",
	]);
	expect(events.indexOf("deliver:first text")).toBeLessThan(
		events.indexOf("save:first text"),
	);
});

test("keeps a stale first result out of a new session while still saving it", async () => {
	const events = [];
	const firstFinalize = deferred();
	let calls = 0;
	const machine = new SessionMachine(
		dependencies(events, async () => {
			calls += 1;
			return calls === 1 ? firstFinalize.promise : "second text";
		}),
	);

	await machine.start();
	const firstStop = machine.stop();
	await machine.start();
	firstFinalize.resolve("first text");
	await firstStop;
	await machine.waitForBackground();

	expect(events).not.toContain("deliver:first text");
	expect(events).toContain("save:first text");
});

test("allows only one active capture and preserves delivered text when server refinement arrives", async () => {
	const events = [];
	const machine = new SessionMachine(
		dependencies(events, async () => "raw text"),
	);

	const sessionId = await machine.start();
	await expect(machine.start()).rejects.toThrow("capture is already active");
	await machine.stop();
	await machine.applyServerRefinement(sessionId, "clean text");

	expect(events).toContain("deliver:raw text");
	expect(events).toContain("update:clean text");
	expect(events).not.toContain("deliver:clean text");
});
