import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type ThemePreference,
	applyThemePreference,
	parseThemePreference,
	readThemePreference,
	saveThemePreference,
	themePreferences,
} from "./theme";

export function ThemeSwitcher() {
	const { t } = useTranslation();
	const [preference, setPreference] = useState<ThemePreference>(() =>
		readThemePreference(),
	);

	function choose(next: ThemePreference) {
		setPreference(next);
		applyThemePreference(next);
		saveThemePreference(next);
	}

	return (
		<label className="theme-switcher" htmlFor="theme-preference">
			{t("theme.label")}
			<select
				id="theme-preference"
				onChange={(event) => choose(parseThemePreference(event.target.value))}
				value={preference}
			>
				{themePreferences.map((option) => (
					<option key={option} value={option}>
						{t(`theme.${option}`)}
					</option>
				))}
			</select>
		</label>
	);
}

/** Title row shown above the pre-sign-in screens. */
export function AppBar() {
	const { t } = useTranslation();
	return (
		<header className="app-bar">
			<h1>{t("app.title")}</h1>
			<ThemeSwitcher />
		</header>
	);
}
