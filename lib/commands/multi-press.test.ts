import { expect, test } from "bun:test";
import { nextCommandPress } from "./multi-press";

test("counts nearby shortcut presses and resets after the core multi-press window", () => {
	expect(nextCommandPress(undefined, 1_000)).toEqual({ count: 1, at: 1_000 });
	expect(nextCommandPress({ count: 1, at: 1_000 }, 1_350)).toEqual({
		count: 2,
		at: 1_350,
	});
	expect(nextCommandPress({ count: 2, at: 1_350 }, 1_701)).toEqual({
		count: 1,
		at: 1_701,
	});
});
