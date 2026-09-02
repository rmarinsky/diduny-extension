import { expect, test } from "bun:test";

test("core loads in a runtime without browser globals", async () => {
	expect(globalThis.document).toBeUndefined();

	const { createCore } = await import("../src/core");

	expect(createCore()).toEqual({ state: "idle" });
});
