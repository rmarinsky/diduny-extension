import { expect, test } from "bun:test";
import {
	choicesWithPending,
	defaultOnboardingChoices,
	parsePendingChoices,
	pendingSettingsChanges,
} from "./onboarding-choices";

test("no changed checkboxes produce no account changes", () => {
	expect(pendingSettingsChanges({}, "forever")).toEqual({ settings: {} });
	expect(choicesWithPending({})).toEqual(defaultOnboardingChoices);
});

test("every changed checkbox is applied, even when it matches the default", () => {
	expect(
		pendingSettingsChanges(
			{
				announceLiveTranscript: false,
				neverSaveRecordings: true,
				textCleanupEnabled: true,
			},
			"forever",
		),
	).toEqual({
		retention: "never",
		settings: { announceLiveTranscript: false, textCleanupEnabled: true },
	});
});

test("unticking never save turns saving back on without replacing other policies", () => {
	expect(
		pendingSettingsChanges({ neverSaveRecordings: false }, "never"),
	).toEqual({ retention: "forever", settings: {} });
	expect(
		pendingSettingsChanges({ neverSaveRecordings: false }, "days30"),
	).toEqual({ settings: {} });
	expect(
		pendingSettingsChanges({ neverSaveRecordings: true }, "never"),
	).toEqual({ settings: {} });
});

test("the start page shows the defaults with the changed checkboxes on top", () => {
	expect(choicesWithPending({ neverSaveRecordings: true })).toEqual({
		...defaultOnboardingChoices,
		neverSaveRecordings: true,
	});
});

test("parses stored choices and drops garbage", () => {
	expect(parsePendingChoices(null)).toEqual({});
	expect(parsePendingChoices("not json")).toEqual({});
	expect(parsePendingChoices("7")).toEqual({});
	expect(
		parsePendingChoices(
			'{"neverSaveRecordings":true,"textCleanupEnabled":"x","other":false}',
		),
	).toEqual({ neverSaveRecordings: true });
});
