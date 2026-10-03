import type { ResolvedTheme } from "./theme";

/**
 * Sun/moon icon button. Prop-driven and free of i18n so the extension pages can
 * reuse it with plain labels. The icon shows the current theme; the label says
 * what a click does.
 */
export function ThemeToggleButton({
	label,
	onToggle,
	theme,
}: {
	label: string;
	onToggle(): void;
	theme: ResolvedTheme;
}) {
	return (
		<button
			aria-label={label}
			aria-pressed={theme === "dark"}
			className="theme-toggle secondary"
			onClick={onToggle}
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
				{theme === "dark" ? (
					<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
				) : (
					<>
						<circle cx="12" cy="12" r="4" />
						<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
					</>
				)}
			</svg>
		</button>
	);
}
