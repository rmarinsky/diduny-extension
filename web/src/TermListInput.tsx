import { type KeyboardEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { MAX_TERMS, MAX_TERM_LENGTH, addTerms, splitDraft } from "./term-list";

/**
 * Word list edited as removable chips. Enter or comma adds the typed entry;
 * spaces stay inside an entry so phrases like "you know" work.
 */
export function TermListInput({
	hint,
	id,
	label,
	onChange,
	placeholder,
	terms,
}: {
	hint: string;
	id: string;
	label: string;
	onChange(terms: readonly string[]): void;
	placeholder: string;
	terms: readonly string[];
}) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState("");
	const full = terms.length >= MAX_TERMS;

	function commit(text = draft) {
		setDraft("");
		if (text.trim()) onChange(addTerms(terms, text));
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if ((event.key === "Enter" && draft.trim()) || event.key === ",") {
			event.preventDefault();
			commit();
			return;
		}
		if (event.key === "Backspace" && !draft && terms.length) {
			event.preventDefault();
			onChange(terms.slice(0, -1));
		}
	}

	return (
		<div className="term-field">
			<label htmlFor={id}>{label}</label>
			<p className="hint" id={`${id}-hint`}>
				{hint}
			</p>
			<div className="term-box">
				{terms.length ? (
					<ul aria-label={label} className="term-chips">
						{terms.map((term) => (
							<li key={term}>
								<span>{term}</span>
								<button
									aria-label={t("settings.removeTerm", { term })}
									onClick={() =>
										onChange(terms.filter((item) => item !== term))
									}
									type="button"
								>
									×
								</button>
							</li>
						))}
					</ul>
				) : null}
				<input
					aria-describedby={`${id}-hint`}
					autoCapitalize="off"
					disabled={full}
					id={id}
					maxLength={MAX_TERM_LENGTH}
					onBlur={() => commit()}
					onChange={(event) => {
						const next = splitDraft(terms, event.target.value);
						setDraft(next.draft);
						if (next.terms !== terms) onChange(next.terms);
					}}
					onKeyDown={onKeyDown}
					onPaste={(event) => {
						const text = event.clipboardData.getData("text");
						if (!/[,;\r\n\t]/.test(text)) return;
						event.preventDefault();
						commit(`${draft}${text}`);
					}}
					placeholder={full ? t("settings.termLimit") : placeholder}
					spellCheck={false}
					value={draft}
				/>
			</div>
		</div>
	);
}
