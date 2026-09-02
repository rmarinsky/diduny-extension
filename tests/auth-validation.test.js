import { expect, test } from "bun:test";
import { isValidEmail, isValidOtp } from "../src/core";

test("rejects malformed or oversized OTP credentials before they reach a transport", () => {
	const boundaryEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
	const unicodeEmail = `${"é".repeat(122)}@example.com`;
	expect(boundaryEmail).toHaveLength(254);
	expect(unicodeEmail).toHaveLength(134);
	expect(new TextEncoder().encode(unicodeEmail)).toHaveLength(256);
	expect(isValidEmail("person@example.com")).toBeTrue();
	expect(isValidEmail(boundaryEmail)).toBeTrue();
	expect(isValidEmail(`${boundaryEmail}x`)).toBeFalse();
	expect(isValidEmail(unicodeEmail)).toBeFalse();
	expect(isValidEmail("not-an-email")).toBeFalse();
	expect(isValidOtp("123456")).toBeTrue();
	expect(isValidOtp("12345")).toBeFalse();
	expect(isValidOtp("12345x")).toBeFalse();
});
