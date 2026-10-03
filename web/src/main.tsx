import { createRoot } from "react-dom/client";
import "./i18n";
import { App } from "./App";
import { applyThemePreference, readThemePreference } from "./theme";

const root = document.getElementById("root");

if (!root) throw new Error("Missing root element");

// The CSP forbids inline head scripts, so apply the saved theme before the first render.
applyThemePreference(readThemePreference());
createRoot(root).render(<App />);
