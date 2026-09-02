import i18next, { type i18n as I18n } from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";
import { uk } from "./locales/uk";

export type UiLocale = "en" | "uk";

export const supportedUiLocales: readonly UiLocale[] = ["en", "uk"];

function config(locale: UiLocale) {
	return {
		fallbackLng: "en",
		initImmediate: false,
		lng: locale,
		resources: { en: { translation: en }, uk: { translation: uk } },
	};
}

export function createI18n(locale: UiLocale = "en") {
	const instance = i18next.createInstance();
	void instance.use(ICU).init(config(locale));
	return instance;
}

const i18n = i18next.createInstance();
void i18n.use(ICU).use(initReactI18next).init(config("en"));

export default i18n;

function resolvedLocale(locale: UiLocale) {
	return locale === "uk" ? "uk" : "en";
}

export function languageName(language: string, locale: UiLocale) {
	return (
		new Intl.DisplayNames([resolvedLocale(locale)], { type: "language" }).of(
			language,
		) ?? language
	);
}

export function formatLocaleDate(value: number | Date, locale: UiLocale) {
	return new Intl.DateTimeFormat(resolvedLocale(locale), {
		dateStyle: "medium",
	}).format(value);
}

export function formatLocaleNumber(value: number, locale: UiLocale) {
	return new Intl.NumberFormat(resolvedLocale(locale)).format(value);
}

export function formatRelativeTime(
	value: number,
	unit: Intl.RelativeTimeFormatUnit,
	locale: UiLocale,
) {
	return new Intl.RelativeTimeFormat(resolvedLocale(locale), {
		numeric: "auto",
	}).format(value, unit);
}

export function currentLocale(instance: I18n = i18n): UiLocale {
	return instance.resolvedLanguage === "uk" ? "uk" : "en";
}

export async function setUiLocale(locale: UiLocale) {
	await i18n.changeLanguage(locale);
	if (typeof document !== "undefined") document.documentElement.lang = locale;
}
