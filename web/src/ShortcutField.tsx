import { type KeyboardEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	shortcutKeyFromEvent,
	shortcutModifiers,
} from "../../src/core/shortcuts";
import {
	type ShortcutParts,
	displayShortcut,
	modifierLabel,
	parseShortcut,
	shortcutPlatform,
	toggleModifier,
} from "./shortcut-editor";

const passThroughKeys = new Set(["Enter", "Escape", "Tab"]);

/**
 * Modifier toggle buttons plus a single key field. Pressing a whole chord
 * with Ctrl, Alt, or Meta held inside the key field records it in one go.
 */
export function ShortcutField({
	onChange,
	value,
}: {
	onChange(parts: ShortcutParts): void;
	value: ShortcutParts;
}) {
	const { t } = useTranslation();
	const [platform] = useState(() => shortcutPlatform());

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (passThroughKeys.has(event.key)) return;
		// Recording a chord such as Alt+Shift+P must not also fire the app's own shortcuts.
		event.preventDefault();
		event.stopPropagation();
		if (event.key === "Backspace" || event.key === "Delete") {
			onChange({ ...value, key: "" });
			return;
		}
		const key = shortcutKeyFromEvent(event);
		if (!key) return;
		// Shift alone is how people type capitals, so only a Ctrl/Alt/Meta chord replaces the toggles.
		const chord = event.ctrlKey || event.altKey || event.metaKey;
		onChange({
			key,
			modifiers: chord
				? shortcutModifiers.filter(
						(modifier) =>
							(modifier === "Ctrl" && event.ctrlKey) ||
							(modifier === "Alt" && event.altKey) ||
							(modifier === "Shift" && event.shiftKey) ||
							(modifier === "Meta" && event.metaKey),
					)
				: value.modifiers,
		});
	}

	return (
		<fieldset
			aria-describedby="dictation-shortcut-help"
			className="shortcut-field"
		>
			<legend>{t("settings.toggleDictation")}</legend>
			<div className="shortcut-row">
				{shortcutModifiers.map((modifier) => (
					<button
						aria-pressed={value.modifiers.includes(modifier)}
						className="toggle"
						key={modifier}
						onClick={() => onChange(toggleModifier(value, modifier))}
						type="button"
					>
						{modifierLabel(modifier, platform)}
					</button>
				))}
				<span aria-hidden="true" className="shortcut-plus">
					+
				</span>
				<label className="shortcut-key" htmlFor="dictation-shortcut-key">
					{t("settings.shortcutKey")}
					<input
						autoCapitalize="off"
						autoComplete="off"
						id="dictation-shortcut-key"
						onChange={(event) => {
							// Virtual keyboards report "Unidentified" keydowns; read the typed character instead.
							const typed = parseShortcut(event.target.value.slice(-1)).key;
							if (typed) onChange({ ...value, key: typed });
						}}
						onKeyDown={onKeyDown}
						spellCheck={false}
						value={value.key}
					/>
				</label>
			</div>
			<p className="hint" id="dictation-shortcut-help">
				{t("settings.shortcutHelp")}
			</p>
			<output className="shortcut-preview">
				{value.key
					? t("settings.shortcutPreview", {
							shortcut: displayShortcut(value, platform),
						})
					: t("settings.shortcutNeedsKey")}
			</output>
		</fieldset>
	);
}
