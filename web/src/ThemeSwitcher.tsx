import { useState } from "hono/jsx/dom";
import { targetValue } from "../../lib/dom-events";
import {
	type ThemePreference,
	applyThemePreference,
	parseThemePreference,
	readThemePreference,
	saveThemePreference,
	themePreferences,
} from "./theme";
import { useTranslation } from "./useTranslation";

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
		<label class="theme-switcher" for="theme-preference">
			{t("theme.label")}
			<select
				id="theme-preference"
				onChange={(event) => choose(parseThemePreference(targetValue(event)))}
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
		<header class="app-bar">
			<h1>{t("app.title")}</h1>
			<ThemeSwitcher />
		</header>
	);
}
