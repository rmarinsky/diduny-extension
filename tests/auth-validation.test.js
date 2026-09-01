import { expect, test } from "bun:test";
import { isValidEmail, isValidOtp } from "../src/core";

test("rejects malformed OTP credentials before they reach a transport", () => {
	expect(isValidEmail("person@example.com")).toBeTrue();
	expect(isValidEmail("not-an-email")).toBeFalse();
	expect(isValidOtp("123456")).toBeTrue();
	expect(isValidOtp("12345")).toBeFalse();
	expect(isValidOtp("12345x")).toBeFalse();
});
