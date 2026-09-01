import { expect, test } from "bun:test";
import { DidunyError } from "../../src/core/errors";
import { errorFromResponse, userErrorMessage } from "./errors";
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
