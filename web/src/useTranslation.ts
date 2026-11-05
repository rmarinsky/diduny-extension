import { useEffect, useMemo, useState } from "hono/jsx/dom";
import i18n from "./i18n";

/**
 * Minimal i18next translation hook: re-renders on language change
 * and keeps `t` referentially stable per language (it is used as an effect dependency).
 */
export function useTranslation() {
	const [language, setLanguage] = useState(i18n.language);
	useEffect(() => {
		const onChange = (next: string) => setLanguage(next);
		i18n.on("languageChanged", onChange);
		return () => i18n.off("languageChanged", onChange);
	}, []);
	const t = useMemo(() => i18n.t.bind(i18n), [language]);
	return { i18n, t };
}
