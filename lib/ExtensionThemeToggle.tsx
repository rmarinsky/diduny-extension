import { useEffect, useState } from "react";
import { ThemeToggleButton } from "../web/src/ThemeToggleButton";
import { applyThemePreference, nextTheme } from "../web/src/theme";
import {
	currentTheme,
	saveStoredTheme,
	watchStoredTheme,
} from "./theme-storage";

/** The extension has no i18n, so the labels are plain English like the rest of its UI. */
export function ExtensionThemeToggle() {
	const [theme, setTheme] = useState(currentTheme);

	// Settings and the side panel stay open side by side; follow a change made in either.
	useEffect(() => watchStoredTheme(setTheme), []);

	function toggle() {
		const next = nextTheme(theme);
		setTheme(next);
		applyThemePreference(next);
		void saveStoredTheme(next);
	}

	return (
		<ThemeToggleButton
			label={
				theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
			}
			onToggle={toggle}
			theme={theme}
		/>
	);
}
