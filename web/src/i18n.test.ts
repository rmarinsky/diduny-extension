import { expect, test } from "bun:test";
import {
	createI18n,
	formatLocaleDate,
	formatLocaleNumber,
	formatRelativeTime,
	languageName,
} from "./i18n";

test("uses ICU plural categories and falls back to English for missing Ukrainian keys", () => {
	const uk = createI18n("uk");
	expect(uk.t("statistics.recordings", { count: 1 })).toBe("1 запис");
	expect(uk.t("statistics.recordings", { count: 2 })).toBe("2 записи");
	expect(uk.t("statistics.recordings", { count: 5 })).toBe("5 записів");
	expect(uk.t("statistics.recordings", { count: 1.5 })).toBe("1,5 запису");
	expect(uk.t("fallback.englishOnly")).toBe("English fallback");
	expect(uk.t("app.nav.dictation")).toBe("Диктування");
});

test("formats language names, dates, and numbers in the selected UI locale", () => {
	expect(languageName("uk", "uk")).toBe("Українська");
	expect(languageName("en", "en")).toBe("English");
	expect(formatLocaleNumber(1234.5, "uk")).toBe("1 234,5");
	expect(formatLocaleDate(Date.UTC(2026, 8, 1), "en")).toContain("2026");
	expect(formatRelativeTime(-1, "day", "en")).toBe("yesterday");
});
