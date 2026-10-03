import { MIC_GRANTED_STORAGE_KEY } from "../../lib/audio/microphone";
import {
	applyStoredTheme,
	currentTheme,
	saveStoredTheme,
	watchStoredTheme,
} from "../../lib/theme-storage";
import { applyThemePreference, nextTheme } from "../../web/src/theme";

const btn = document.getElementById("grant") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLElement;
const themeBtn = document.getElementById("theme") as HTMLButtonElement;

// Same icons as the React ThemeToggleButton used on the other extension pages.
const SUN =
	'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';

function renderThemeToggle() {
	const dark = currentTheme() === "dark";
	themeBtn.setAttribute(
		"aria-label",
		dark ? "Switch to light theme" : "Switch to dark theme",
	);
	themeBtn.setAttribute("aria-pressed", String(dark));
	themeBtn.innerHTML = `<svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${dark ? MOON : SUN}</svg>`;
}

void applyStoredTheme().then(renderThemeToggle);
watchStoredTheme(renderThemeToggle);
themeBtn.addEventListener("click", () => {
	const next = nextTheme(currentTheme());
	applyThemePreference(next);
	void saveStoredTheme(next);
	renderThemeToggle();
});

function failureMessage(err: unknown) {
	const name = err instanceof Error ? err.name : "";
	const message = err instanceof Error ? err.message : "";
	if (name === "NotAllowedError" && /dismiss/i.test(message))
		return "The prompt was closed. Click the button again and choose Allow while visiting the site.";
	if (name === "NotAllowedError")
		return "Microphone is blocked for Diduny. Allow it in Chrome's site settings for this extension, then try again.";
	if (name === "NotFoundError")
		return "No microphone found. Connect one and try again.";
	return `Could not access the microphone: ${message || "unknown error"}`;
}

btn.addEventListener("click", async () => {
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		for (const track of stream.getTracks()) track.stop();
		// Only a real grant is remembered; the background reads this when the tab closes.
		await chrome.storage.local.set({ [MIC_GRANTED_STORAGE_KEY]: true });
		statusEl.className = "success";
		statusEl.textContent = "Microphone access granted! You can close this tab.";
		btn.style.display = "none";
		// Auto-close after a short delay
		setTimeout(() => window.close(), 1500);
	} catch (err) {
		statusEl.className = "error";
		statusEl.textContent = failureMessage(err);
	}
});
