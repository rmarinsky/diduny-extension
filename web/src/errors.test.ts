import { expect, test } from "bun:test";
import { DidunyError } from "../../src/core/errors";
import {
	errorFromResponse,
	isIncorrectOtpError,
	isInvalidEmailError,
	pastedTranslationErrorMessage,
	userErrorMessage,
} from "./errors";
import { createI18n } from "./i18n";

test("maps BFF quota, authentication, and upstream failures to distinct user actions", () => {
	const i18n = createI18n("en");
	const t = i18n.t.bind(i18n);
	const quota = errorFromResponse(402, { limitHours: 2, usedHours: 2 });

	expect(quota).toMatchObject({
		code: "quota_exhausted",
		details: { limitHours: 2, usedHours: 2 },
	});
	expect(userErrorMessage(quota, t)).toContain("out of hours");
	expect(userErrorMessage(errorFromResponse(401, {}), t)).toContain("Sign in");
	expect(
		userErrorMessage(
			errorFromResponse(502, { error: "upstream_unreachable" }),
			t,
		),
	).toContain("transcription proxy");
});

test("never exposes an unknown Error message directly to the UI", () => {
	const i18n = createI18n("en");
	const t = i18n.t.bind(i18n);

	expect(userErrorMessage(new Error("database credentials"), t)).not.toContain(
		"database credentials",
	);
	expect(
		userErrorMessage(
			new DidunyError("remote_acquisition_unavailable_on_web"),
			t,
		),
	).toContain("YouTube");
	const ukrainian = createI18n("uk");
	expect(
		userErrorMessage(
			new DidunyError("local_process_unreachable"),
			ukrainian.t.bind(ukrainian),
		),
	).toContain("Локальний процес Diduny");
});

test("keeps the upstream error body on typed request failures", () => {
	const body = { error: "provider_rejected", reason: "unsupported language" };
	expect(errorFromResponse(422, body)).toMatchObject({
		code: "request_rejected",
		details: { body, status: 422 },
	});
});

test("recognises a BFF invalid_email rejection only for a 400", () => {
	expect(
		isInvalidEmailError(errorFromResponse(400, { error: "invalid_email" })),
	).toBeTrue();
	expect(
		isInvalidEmailError(errorFromResponse(400, { error: "invalid_otp" })),
	).toBeFalse();
	expect(
		isInvalidEmailError(
			errorFromResponse(502, { error: "upstream_auth_unavailable" }),
		),
	).toBeFalse();
	expect(isInvalidEmailError(new Error("invalid_email"))).toBeFalse();
});

test("recognises a refused one-time code apart from an expired session or outage", () => {
	expect(
		isIncorrectOtpError(
			errorFromResponse(401, { error: "otp_verification_failed" }),
		),
	).toBeTrue();
	expect(
		isIncorrectOtpError(errorFromResponse(401, { error: "unauthenticated" })),
	).toBeFalse();
	expect(
		isIncorrectOtpError(
			errorFromResponse(502, { error: "upstream_auth_unavailable" }),
		),
	).toBeFalse();
});

test("words paste-in translation failures for the paste panel", () => {
	const i18n = createI18n("en");
	const t = i18n.t.bind(i18n);

	expect(
		pastedTranslationErrorMessage(new DidunyError("empty_result"), t),
	).toBe(
		"The translation returned no text. Check the language pair and try again.",
	);
	for (const error of [
		errorFromResponse(500, { error: "upstream_failed" }),
		new DidunyError("local_process_unreachable"),
		new Error("network"),
	])
		expect(pastedTranslationErrorMessage(error, t)).toBe(
			"Could not translate the pasted text. Check the Diduny service and try again.",
		);
	expect(
		pastedTranslationErrorMessage(
			errorFromResponse(402, { limitHours: 2, usedHours: 2 }),
			t,
		),
	).toContain("out of hours");
});
