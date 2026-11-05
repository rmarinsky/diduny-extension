import { UNTITLED_RECORDING_TITLE } from "../../src/core/ports";

/** A library title in the interface language: the server names untitled recordings in English. */
export function recordingTitle(displayTitle: string, untitledLabel: string) {
	return displayTitle === UNTITLED_RECORDING_TITLE
		? untitledLabel
		: displayTitle;
}

/** A recording length as m:ss. */
export function duration(seconds: number) {
	const total = Math.max(0, Math.round(seconds));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function dateTime(
	value: number,
	locale: string,
	{ withSeconds = false }: { withSeconds?: boolean } = {},
) {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: withSeconds ? "medium" : "short",
	}).format(value);
}
