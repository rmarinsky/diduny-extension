import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ThemeToggleButton } from "./ThemeToggleButton";
import {
	type ResolvedTheme,
	applyThemePreference,
	nextTheme,
	readThemePreference,
	resolveTheme,
	saveThemePreference,
	systemPrefersDark,
} from "./theme";

export function ThemeToggle() {
	const { t } = useTranslation();
	const [theme, setTheme] = useState<ResolvedTheme>(() =>
		resolveTheme(readThemePreference(), systemPrefersDark()),
	);

	function toggle() {
		const next = nextTheme(theme);
		setTheme(next);
		applyThemePreference(next);
		saveThemePreference(next);
	}

	return (
		<ThemeToggleButton
			label={
				theme === "dark" ? t("theme.toggleToLight") : t("theme.toggleToDark")
			}
			onToggle={toggle}
			theme={theme}
		/>
	);
}

/** Title row shown above the pre-sign-in screens. */
export function AppBar() {
	const { t } = useTranslation();
	return (
		<header className="app-bar">
			<h1>{t("app.title")}</h1>
			<ThemeToggle />
		</header>
	);
}
