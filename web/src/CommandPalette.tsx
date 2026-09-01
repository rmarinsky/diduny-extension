import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { LibraryPage } from "../../src/core/ports";
import { userErrorMessage } from "./errors";
import i18n from "./i18n";
import { getLibraryRecording, listLibraryRecordings } from "./library";

export function CommandPalette({
	onClose,
	onCopied,
}: {
	onClose(): void;
	onCopied(message: string): void;
}) {
	const { t } = useTranslation();
	const input = useRef<HTMLInputElement>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const [error, setError] = useState("");
	const [isLoading, setIsLoading] = useState(true);
	const [page, setPage] = useState<LibraryPage>({ items: [] });
	const [query, setQuery] = useState("");

	useEffect(() => {
		let active = true;
		input.current?.focus();
		setIsLoading(true);
		setError("");
		void listLibraryRecordings({ limit: 10, search: query.trim() })
			.then((next) => {
				if (!active) return;
				setPage(next);
				setActiveIndex(0);
			})
			.catch((reason) => {
				if (active) setError(userErrorMessage(reason, i18n.t.bind(i18n)));
			})
			.finally(() => {
				if (active) setIsLoading(false);
			});
		return () => {
			active = false;
		};
	}, [query]);

	const copy = useCallback(
		async (id: string) => {
			try {
				const recording = await getLibraryRecording(id);
				await navigator.clipboard.writeText(recording.displayText);
				onCopied(t("library.transcriptCopied"));
				onClose();
			} catch (reason) {
				setError(userErrorMessage(reason, t));
			}
		},
		[onClose, onCopied, t],
	);

	function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
		if (event.key === "Escape") {
			event.preventDefault();
			onClose();
			return;
		}
		if (event.key === "ArrowDown") {
			if (!page.items.length) return;
			event.preventDefault();
			setActiveIndex((index) => Math.min(index + 1, page.items.length - 1));
			return;
		}
		if (event.key === "ArrowUp") {
			if (!page.items.length) return;
			event.preventDefault();
			setActiveIndex((index) => Math.max(index - 1, 0));
			return;
		}
		if (event.key === "Enter") {
			const selected = page.items[activeIndex];
			if (!selected) return;
			event.preventDefault();
			void copy(selected.id);
		}
	}

	return (
		<div className="command-palette-backdrop">
			<dialog
				aria-labelledby="command-palette-title"
				aria-modal="true"
				className="command-palette"
				onKeyDown={onKeyDown}
				open
			>
				<header>
					<h2 id="command-palette-title">{t("commandPalette.title")}</h2>
					<button
						aria-label={t("commandPalette.close")}
						onClick={onClose}
						type="button"
					>
						×
					</button>
				</header>
				<label htmlFor="command-palette-search">
					{t("commandPalette.search")}
					<input
						id="command-palette-search"
						onChange={(event) => setQuery(event.target.value)}
						ref={input}
						value={query}
					/>
				</label>
				{isLoading ? <p>{t("commandPalette.loading")}</p> : null}
				{error ? <p role="alert">{error}</p> : null}
				{!isLoading && !error && page.items.length === 0 ? (
					<p>{t("commandPalette.empty")}</p>
				) : null}
				<ul aria-label={t("commandPalette.results")}>
					{page.items.map((recording, index) => (
						<li key={recording.id}>
							<button
								aria-current={activeIndex === index ? "true" : undefined}
								onClick={() => void copy(recording.id)}
								type="button"
							>
								{recording.displayTitle}
							</button>
						</li>
					))}
				</ul>
			</dialog>
		</div>
	);
}
