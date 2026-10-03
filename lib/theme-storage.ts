import {
	type ResolvedTheme,
	type ThemePreference,
	applyThemePreference,
	parseThemePreference,
	resolveTheme,
	systemPrefersDark,
} from "../web/src/theme";

/** Extension pages keep prefs in chrome.storage.local, like every other extension setting. */
export const THEME_STORAGE_KEY = "didunyTheme";

export async function readStoredTheme(): Promise<ThemePreference> {
	try {
		const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
		return parseThemePreference(stored[THEME_STORAGE_KEY]);
	} catch {
		return "system";
	}
}

export async function saveStoredTheme(theme: ResolvedTheme) {
	try {
		await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
	} catch {
		// The choice still applies to this page.
	}
}

/**
 * Applies a theme saved by another extension page while this one stays open.
 * Returns a function that stops watching.
 */
export function watchStoredTheme(onChange: (theme: ResolvedTheme) => void) {
	const listener = (
		changes: Record<string, chrome.storage.StorageChange>,
		areaName: string,
	) => {
		if (areaName !== "local" || !(THEME_STORAGE_KEY in changes)) return;
		applyThemePreference(
			parseThemePreference(changes[THEME_STORAGE_KEY]?.newValue),
		);
		onChange(currentTheme());
	};
	chrome.storage.onChanged.addListener(listener);
	return () => chrome.storage.onChanged.removeListener(listener);
}

/** Call before first render so the page never paints in the wrong theme. */
export async function applyStoredTheme() {
	applyThemePreference(await readStoredTheme());
}

export function currentTheme(): ResolvedTheme {
	return resolveTheme(
		parseThemePreference(document.documentElement.getAttribute("data-theme")),
		systemPrefersDark(),
	);
}
