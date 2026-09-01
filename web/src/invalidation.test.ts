import { expect, test } from "bun:test";
import { createWorkspaceInvalidationBus } from "./invalidation";

test("broadcasts only cache invalidation signals and ignores state-shaped messages", () => {
	let listener: ((event: MessageEvent<unknown>) => void) | undefined;
	const posted: unknown[] = [];
	const channel = {
		addEventListener(
			_type: "message",
			callback: (event: MessageEvent<unknown>) => void,
		) {
			listener = callback;
		},
		close() {},
		postMessage(message: unknown) {
			posted.push(message);
		},
		removeEventListener() {},
	};
	const bus = createWorkspaceInvalidationBus(channel);
	let invalidations = 0;
	const unsubscribe = bus.subscribe(() => {
		invalidations += 1;
	});

	bus.invalidate();
	expect(posted).toEqual([{ type: "invalidate" }]);
	listener?.({
		data: { type: "invalidate", settings: { leaked: true } },
	} as MessageEvent);
	expect(invalidations).toBe(0);
	listener?.({ data: { type: "invalidate" } } as MessageEvent);
	expect(invalidations).toBe(1);
	unsubscribe();
});
