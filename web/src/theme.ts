export const themePreferences = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof themePreferences)[number];

export const themeStorageKey = "diduny.theme";

interface ThemeStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface ThemeRoot {
	removeAttribute(name: string): void;
	setAttribute(name: string, value: string): void;
}

export function parseThemePreference(value: unknown): ThemePreference {
	return themePreferences.includes(value as ThemePreference)
		? (value as ThemePreference)
		: "system";
}

// Merely touching localStorage can throw (blocked site data), so resolve it inside try.
export function readThemePreference(storage?: ThemeStorage): ThemePreference {
	try {
		return parseThemePreference(
			(storage ?? localStorage).getItem(themeStorageKey),
		);
	} catch {
		return "system";
	}
}

export function saveThemePreference(
	preference: ThemePreference,
	storage?: ThemeStorage,
) {
	try {
		(storage ?? localStorage).setItem(themeStorageKey, preference);
	} catch {
		// Storage can be unavailable; the choice still applies to this page.
	}
}

export type ResolvedTheme = "light" | "dark";

/** "system" resolves through the OS preference; an explicit choice wins. */
export function resolveTheme(
	preference: ThemePreference,
	prefersDark: boolean,
): ResolvedTheme {
	if (preference === "system") return prefersDark ? "dark" : "light";
	return preference;
}

export function nextTheme(current: ResolvedTheme): ResolvedTheme {
	return current === "dark" ? "light" : "dark";
}

export function systemPrefersDark(): boolean {
	try {
		return matchMedia("(prefers-color-scheme: dark)").matches;
	} catch {
		return false;
	}
}

/** "system" leaves the attribute off so the prefers-color-scheme media query decides. */
export function applyThemePreference(
	preference: ThemePreference,
	root: ThemeRoot = document.documentElement,
) {
	if (preference === "system") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", preference);
}
