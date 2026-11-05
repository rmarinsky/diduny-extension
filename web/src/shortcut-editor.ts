import {
	type ShortcutModifier,
	normalizeShortcut,
	shortcutModifiers,
} from "../../src/core/shortcuts";

export type ShortcutPlatform = "mac" | "other" | "windows";

export interface ShortcutParts {
	key: string;
	modifiers: readonly ShortcutModifier[];
}

const modifierLabels: Record<
	ShortcutPlatform,
	Record<ShortcutModifier, string>
> = {
	mac: {
		Alt: "⌥ Option",
		Ctrl: "⌃ Control",
		Meta: "⌘ Command",
		Shift: "⇧ Shift",
	},
	other: { Alt: "Alt", Ctrl: "Ctrl", Meta: "Meta", Shift: "Shift" },
	windows: { Alt: "Alt", Ctrl: "Ctrl", Meta: "⊞ Win", Shift: "Shift" },
};

interface PlatformNavigator {
	platform?: string;
	userAgentData?: { platform?: string };
}

export function shortcutPlatform(
	environment: PlatformNavigator | undefined = globalThis.navigator,
): ShortcutPlatform {
	const platform =
		environment?.userAgentData?.platform ?? environment?.platform ?? "";
	if (/mac|iphone|ipad/i.test(platform)) return "mac";
	if (/win/i.test(platform)) return "windows";
	return "other";
}

export function modifierLabel(
	modifier: ShortcutModifier,
	platform: ShortcutPlatform,
) {
	return modifierLabels[platform][modifier];
}

export function parseShortcut(value: string): ShortcutParts {
	const normalized = normalizeShortcut(value);
	if (!normalized) return { key: "", modifiers: [] };
	const parts = normalized.split("+");
	return {
		key: parts.at(-1) ?? "",
		modifiers: shortcutModifiers.filter((modifier) => parts.includes(modifier)),
	};
}

/** Canonical "Alt+Shift+D" form, or null while no valid key is chosen. */
export function composeShortcut({ key, modifiers }: ShortcutParts) {
	if (!key) return null;
	return normalizeShortcut([...modifiers, key].join("+"));
}

/** Human-readable chord for the current platform, e.g. "⌥ Option + ⇧ Shift + D". */
export function displayShortcut(
	parts: ShortcutParts,
	platform: ShortcutPlatform,
) {
	return [
		...shortcutModifiers
			.filter((modifier) => parts.modifiers.includes(modifier))
			.map((modifier) => modifierLabel(modifier, platform)),
		...(parts.key ? [parts.key] : []),
	].join(" + ");
}

export function toggleModifier(
	parts: ShortcutParts,
	modifier: ShortcutModifier,
): ShortcutParts {
	return {
		...parts,
		modifiers: parts.modifiers.includes(modifier)
			? parts.modifiers.filter((item) => item !== modifier)
			: shortcutModifiers.filter(
					(item) => item === modifier || parts.modifiers.includes(item),
				),
	};
}
