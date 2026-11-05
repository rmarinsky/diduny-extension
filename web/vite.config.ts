import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
	root: dirname(fileURLToPath(import.meta.url)),
	esbuild: { jsx: "automatic", jsxImportSource: "hono/jsx/dom" },
});
