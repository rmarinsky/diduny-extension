import { createRoot } from "react-dom/client";
import { crashLog } from "../../lib/crash-log";
import { applyStoredTheme } from "../../lib/theme-storage";
import { App } from "./App";
import "./style.css";

// Capture side panel crashes
window.addEventListener("error", (event) => {
	crashLog(
		"sidepanel",
		"error",
		event.message,
		event.error instanceof Error ? event.error.stack : undefined,
	);
});
window.addEventListener("unhandledrejection", (event) => {
	const reason = event.reason;
	crashLog(
		"sidepanel",
		"error",
		reason instanceof Error ? reason.message : String(reason),
		reason instanceof Error ? reason.stack : undefined,
	);
});

const root = document.getElementById("root");
// Apply the saved theme first so the panel never flashes the wrong one.
if (root) void applyStoredTheme().then(() => createRoot(root).render(<App />));
