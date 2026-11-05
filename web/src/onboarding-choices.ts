import type { RetentionPolicy } from "../../src/core/ports";
import { DEFAULT_SETTINGS, type Settings } from "../../src/core/settings";

/** The settings the delivery flow lets you change before or after signing in. */
export interface OnboardingChoices {
	announceLiveTranscript: boolean;
	neverSaveRecordings: boolean;
	textCleanupEnabled: boolean;
}

/**
 * The checkboxes the visitor actually changed before signing in. Only these are
 * applied, so passing through the start page never overwrites an account's settings.
 */
export type PendingChoices = Partial<OnboardingChoices>;

export const defaultOnboardingChoices: OnboardingChoices = {
	announceLiveTranscript: DEFAULT_SETTINGS.announceLiveTranscript,
	neverSaveRecordings: false,
	textCleanupEnabled: DEFAULT_SETTINGS.textCleanupEnabled,
};

export const pendingChoicesStorageKey = "diduny.onboarding.settings";

const choiceKeys = Object.keys(defaultOnboardingChoices) as Array<
	keyof OnboardingChoices
>;

export function parsePendingChoices(raw: string | null): PendingChoices {
	if (!raw) return {};
	try {
		const value = JSON.parse(raw) as Record<string, unknown> | null;
		if (!value || typeof value !== "object") return {};
		const pending: PendingChoices = {};
		for (const key of choiceKeys)
			if (typeof value[key] === "boolean") pending[key] = value[key];
		return pending;
	} catch {
		return {};
	}
}

/** What the checkboxes show before sign-in: the defaults with the visitor's changes on top. */
export function choicesWithPending(pending: PendingChoices): OnboardingChoices {
	return { ...defaultOnboardingChoices, ...pending };
}

/**
 * The account changes for the visitor's choices. Unticking "Never save recordings"
 * only turns saving back on; it leaves a 7- or 30-day retention policy alone.
 */
export function pendingSettingsChanges(
	pending: PendingChoices,
	currentRetention: RetentionPolicy,
): { retention?: RetentionPolicy; settings: Partial<Settings> } {
	const settings: Partial<Settings> = {};
	if (pending.announceLiveTranscript !== undefined)
		settings.announceLiveTranscript = pending.announceLiveTranscript;
	if (pending.textCleanupEnabled !== undefined)
		settings.textCleanupEnabled = pending.textCleanupEnabled;
	const retention =
		pending.neverSaveRecordings === true
			? "never"
			: pending.neverSaveRecordings === false && currentRetention === "never"
				? "forever"
				: undefined;
	return retention && retention !== currentRetention
		? { retention, settings }
		: { settings };
}
