import { expect, test } from "bun:test";
import { FINALIZE_PROFILES, REALTIME, RealtimeSession } from "../src/core";

function scheduler() {
	const tasks = [];
	return {
		clearTimeout(id) {
			const task = tasks.find((candidate) => candidate === id);
			if (task) task.cancelled = true;
		},
		run(delay) {
			for (const task of tasks.filter(
				(candidate) => candidate.delay === delay && !candidate.cancelled,
			)) {
				task.cancelled = true;
				task.callback();
			}
		},
		setTimeout(callback, delay) {
			const task = { callback, cancelled: false, delay };
			tasks.push(task);
			return task;
		},
	};
}

test("flushes pre-ready audio before frames that arrive while flushing", () => {
	const timer = scheduler();
	const sent = [];
	let handlers;
	const session = new RealtimeSession({
		connect(next) {
			handlers = next;
			return {
				close() {},
				send(frame) {
					sent.push([...frame]);
					if (sent.length === 1) session.sendAudio(new Uint8Array([3]));
				},
			};
		},
		onComplete() {},
		onError() {},
		onTokens() {},
		scheduler: timer,
	});

	session.start();
	session.sendAudio(new Uint8Array([1]));
	session.sendAudio(new Uint8Array([2]));
	handlers.message('{"type":"proxy_ready"}');

	expect(sent).toEqual([[1], [2], [3]]);
});

test("times out a socket that never becomes proxy_ready", () => {
	const timer = scheduler();
	const errors = [];
	const session = new RealtimeSession({
		connect() {
			return { close() {}, send() {} };
		},
		onComplete() {},
		onError(error) {
			errors.push(error.code);
		},
		onTokens() {},
		scheduler: timer,
	});

	session.start();
	timer.run(REALTIME.readyWatchdogMs);

	expect(errors).toEqual(["realtime_ready_timeout"]);
});

test("coalesces clean tokens, then finalizes with the configured fast profile", () => {
	const timer = scheduler();
	const updates = [];
	const sent = [];
	let handlers;
	const session = new RealtimeSession({
		connect(next) {
			handlers = next;
			return { close() {}, send: (frame) => sent.push(frame) };
		},
		onComplete() {},
		onError() {},
		onTokens(tokens) {
			updates.push(tokens);
		},
		scheduler: timer,
	});

	session.start();
	handlers.message('{"type":"proxy_ready"}');
	handlers.message(
		'{"tokens":[{"text":"Hello<end>","is_final":true},{"text":" world<fin>","is_final":false}]}',
	);
	timer.run(1_000 / REALTIME.uiUpdatesPerSecond);
	expect(updates).toEqual([
		[
			{ isFinal: true, text: "Hello" },
			{ isFinal: false, text: " world" },
		],
	]);

	session.finalize();
	timer.run(FINALIZE_PROFILES.dictationFast.controlMessageDelayMs);
	expect(sent).toEqual(['{"type":"finalize"}', new Uint8Array()]);
});

test("reconnects if the socket closes while finalization is pending", () => {
	const timer = scheduler();
	let attempts = 0;
	let handlers;
	const session = new RealtimeSession({
		connect(next) {
			attempts += 1;
			handlers = next;
			return { close() {}, send() {} };
		},
		onComplete() {},
		onError() {},
		onTokens() {},
		scheduler: timer,
	});

	session.start();
	handlers.message('{"type":"proxy_ready"}');
	session.finalize();
	handlers.close({ code: 1011 });
	timer.run(REALTIME.reconnectBackoffMs);

	expect(attempts).toBe(2);
});

test("reconnects only a bounded number of times and never retries quota exhaustion", () => {
	const timer = scheduler();
	const errors = [];
	let attempts = 0;
	let handlers;
	const session = new RealtimeSession({
		connect(next) {
			attempts += 1;
			handlers = next;
			return { close() {}, send() {} };
		},
		onComplete() {},
		onError(error) {
			errors.push(error.code);
		},
		onTokens() {},
		scheduler: timer,
	});

	session.start();
	for (
		let attempt = 1;
		attempt <= REALTIME.maxReconnectAttempts;
		attempt += 1
	) {
		handlers.close({ code: 1011 });
		timer.run(REALTIME.reconnectBackoffMs * attempt);
	}
	handlers.close({ code: 1011 });
	expect(attempts).toBe(REALTIME.maxReconnectAttempts + 1);
	expect(errors).toEqual(["realtime_unavailable"]);

	const quotaErrors = [];
	const quota = new RealtimeSession({
		connect(next) {
			handlers = next;
			return { close() {}, send() {} };
		},
		onComplete() {},
		onError(error) {
			quotaErrors.push(error.code);
		},
		onTokens() {},
		scheduler: timer,
	});
	quota.start();
	handlers.close({ code: REALTIME.quotaCloseCode });
	timer.run(REALTIME.reconnectBackoffMs);
	expect(quotaErrors).toEqual(["quota_exhausted"]);
});
