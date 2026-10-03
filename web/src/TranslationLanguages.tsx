import { useTranslation } from "react-i18next";
import { dictationLanguages, ownLanguageName } from "./languages";
import type { TranslationPair } from "./translation";

/**
 * From ⇄ To pickers for a translation pair. Choosing the language already on
 * the other side swaps the two, so the pair never translates into itself.
 */
export function TranslationLanguages({
	disabled,
	idPrefix,
	label,
	onChange,
	pair,
}: {
	disabled: boolean;
	idPrefix: string;
	label: string;
	onChange(pair: TranslationPair): void;
	pair: TranslationPair;
}) {
	const { t } = useTranslation();
	const { sourceLanguage, targetLanguage } = pair;
	const swapped = {
		sourceLanguage: targetLanguage,
		targetLanguage: sourceLanguage,
	};

	function chooseSource(language: string) {
		onChange(
			language === targetLanguage
				? swapped
				: { sourceLanguage: language, targetLanguage },
		);
	}

	function chooseTarget(language: string) {
		onChange(
			language === sourceLanguage
				? swapped
				: { sourceLanguage, targetLanguage: language },
		);
	}

	return (
		<fieldset
			aria-label={label}
			className="translation-languages"
			disabled={disabled}
		>
			<label htmlFor={`${idPrefix}-source`}>
				{t("translation.from")}
				<select
					id={`${idPrefix}-source`}
					onChange={(event) => chooseSource(event.target.value)}
					value={sourceLanguage}
				>
					{dictationLanguages.map((language) => (
						<option key={language} lang={language} value={language}>
							{ownLanguageName(language)}
						</option>
					))}
				</select>
			</label>
			<button
				aria-label={t("translation.swap")}
				className="swap secondary"
				onClick={() => onChange(swapped)}
				title={t("translation.swap")}
				type="button"
			>
				<svg
					aria-hidden="true"
					fill="none"
					focusable="false"
					height="20"
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="2"
					viewBox="0 0 24 24"
					width="20"
				>
					<path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />
				</svg>
			</button>
			<label htmlFor={`${idPrefix}-target`}>
				{t("translation.to")}
				<select
					id={`${idPrefix}-target`}
					onChange={(event) => chooseTarget(event.target.value)}
					value={targetLanguage}
				>
					{dictationLanguages.map((language) => (
						<option key={language} lang={language} value={language}>
							{ownLanguageName(language)}
						</option>
					))}
				</select>
			</label>
		</fieldset>
	);
}
