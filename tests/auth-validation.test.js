import { expect, test } from "bun:test";
import {
	isValidEmail,
	isValidOtp,
	normalizeEmail,
	normalizeOtp,
} from "../src/core";
import { invalidEmails, projectEmails, validEmails } from "./fixtures/emails";

test.each([...validEmails, ...projectEmails])("accepts %s", (email) => {
	expect(isValidEmail(email)).toBeTrue();
});

test.each(invalidEmails)("rejects %s", (email) => {
	expect(isValidEmail(email)).toBeFalse();
});

test.each([
	"",
	"@example.com",
	"person@",
	"john..doe@example.com",
	".person@example.com",
	"person.@example.com",
	"person@-example.com",
	"person@example-.com",
	"person@example..com",
	"person@example.123",
	"person@[256.1.1.1]",
	"person@[1.2.3]",
	"person@[IPv6:2001:db8::1::2]",
	"person@[IPv6:not-an-address]",
	" person@example.com",
	"person@example.com ",
	"per son@example.com",
	'"unterminated@example.com',
])("rejects edge case %p", (email) => {
	expect(isValidEmail(email)).toBeFalse();
});

test("limits the local part to 64 UTF-8 octets", () => {
	expect(isValidEmail(`${"a".repeat(64)}@example.com`)).toBeTrue();
	expect(isValidEmail(`${"a".repeat(65)}@example.com`)).toBeFalse();
	// "é" is two octets, so 33 of them exceed the limit at 33 characters.
	expect(isValidEmail(`${"é".repeat(32)}@example.com`)).toBeTrue();
	expect(isValidEmail(`${"é".repeat(33)}@example.com`)).toBeFalse();
});

test("limits the whole address to 254 octets", () => {
	const domain = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(55)}`;
	expect(isValidEmail(`${"x".repeat(7)}@${domain}`)).toBeFalse();
	expect(isValidEmail(`${"x".repeat(5)}@${domain.slice(2)}`)).toBeTrue();
});

test("normalizes pasted whitespace and Unicode composition", () => {
	expect(normalizeEmail("  person@example.com\n")).toBe("person@example.com");
	const composed = "café@example.com".normalize("NFC");
	const decomposed = composed.normalize("NFD");
	expect(decomposed).not.toBe(composed);
	expect(normalizeEmail(decomposed)).toBe(composed);
	expect(isValidEmail(normalizeEmail(" person@example.com "))).toBeTrue();
});

test("rejects non-string input", () => {
	expect(isValidEmail(undefined)).toBeFalse();
	expect(isValidEmail(42)).toBeFalse();
});

test("rejects malformed OTP credentials before they reach a transport", () => {
	expect(isValidOtp("123456")).toBeTrue();
	expect(isValidOtp("12345")).toBeFalse();
	expect(isValidOtp("12345x")).toBeFalse();
});

test("drops the spaces a code picks up when pasted", () => {
	expect(normalizeOtp(" 123 456\n")).toBe("123456");
	expect(isValidOtp(normalizeOtp("12 34 5"))).toBeFalse();
});
