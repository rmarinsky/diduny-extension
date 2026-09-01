import { expect, test } from "bun:test";
import { selectDeliverySession } from "./delivery-session";

test("keeps the frame that contained the focused text field", () => {
	const session = selectDeliverySession(17, [
		{ frameId: 0, result: { ready: false } },
		{ frameId: 4, result: { ready: true } },
	]);

	expect(session).toEqual({ tabId: 17, frameId: 4 });
});
