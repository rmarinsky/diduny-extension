import { expect, test } from "bun:test";
import { sendBffOtp, verifyBffOtp } from "./auth";

test("rejects malformed credentials before issuing a BFF request", async () => {
	await expect(sendBffOtp("not-an-email")).rejects.toThrow("Invalid email");
	await expect(verifyBffOtp("person@example.com", "12345")).rejects.toThrow(
		"Invalid one-time code",
	);
});
