import { expect, test } from "bun:test";
import { selectDeliverySession } from "./delivery-session";

test("keeps the frame that contained the focused text field", () => {
	const session = selectDeliverySession(17, [
		{ frameId: 0, result: { origin: "https://linear.app", ready: false } },
		{
			frameId: 4,
			result: { origin: "https://comments.example.test", ready: true },
		},
	]);

	expect(session).toEqual({
		frameId: 4,
		origin: "https://comments.example.test",
		tabId: 17,
	});
});
