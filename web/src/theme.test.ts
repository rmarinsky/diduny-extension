import { expect, test } from "bun:test";
import {
	applyThemePreference,
	nextTheme,
	parseThemePreference,
	readThemePreference,
	resolveTheme,
	saveThemePreference,
	themeStorageKey,
} from "./theme";

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
		values,
	};
}

test("falls back to the system theme for unknown stored values", () => {
	expect(parseThemePreference("dark")).toBe("dark");
	expect(parseThemePreference("sepia")).toBe("system");
	expect(parseThemePreference(null)).toBe("system");
});

test("reads and saves the preference, surviving unavailable storage", () => {
	const storage = memoryStorage();
	saveThemePreference("light", storage);
	expect(storage.values.get(themeStorageKey)).toBe("light");
	expect(readThemePreference(storage)).toBe("light");

	const blocked = {
		getItem(): string | null {
			throw new Error("SecurityError");
		},
		setItem() {
			throw new Error("SecurityError");
		},
	};
	expect(readThemePreference(blocked)).toBe("system");
	expect(() => saveThemePreference("dark", blocked)).not.toThrow();
});

test("resolves system through the OS preference and flips between two states", () => {
	expect(resolveTheme("system", true)).toBe("dark");
	expect(resolveTheme("system", false)).toBe("light");
	expect(resolveTheme("light", true)).toBe("light");
	expect(resolveTheme("dark", false)).toBe("dark");
	expect(nextTheme("dark")).toBe("light");
	expect(nextTheme("light")).toBe("dark");
});

test("sets data-theme for explicit choices and clears it for system", () => {
	const attributes = new Map<string, string>();
	const root = {
		removeAttribute: (name: string) => void attributes.delete(name),
		setAttribute: (name: string, value: string) =>
			void attributes.set(name, value),
	};
	applyThemePreference("dark", root);
	expect(attributes.get("data-theme")).toBe("dark");
	applyThemePreference("system", root);
	expect(attributes.has("data-theme")).toBeFalse();
});
