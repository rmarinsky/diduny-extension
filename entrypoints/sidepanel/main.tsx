import { render } from "hono/jsx/dom";
import { crashLog } from "../../lib/crash-log";
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
if (root) render(<App />, root);
