import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

type SourceFile = { path: string; source: string };

const forbidden = [
	{ label: "node: import", pattern: /\b(?:from\s*|import\s*\(?\s*)["']node:/ },
	{ label: "window global", pattern: /\bwindow\b/ },
	{ label: "document global", pattern: /\bdocument\b/ },
	{ label: "navigator global", pattern: /\bnavigator\b/ },
];

export function findCoreBoundaryViolations(files: readonly SourceFile[]) {
	return files.flatMap(({ path, source }) =>
		forbidden
			.filter(({ pattern }) => pattern.test(source))
			.map(({ label }) => `${path}: ${label}`),
	);
}

async function collectSources(directory: string): Promise<SourceFile[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const sources = await Promise.all(
		entries.map(async (entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return collectSources(path);
			if (!entry.name.endsWith(".ts")) return [];
			return [{ path, source: await readFile(path, "utf8") }];
		}),
	);
	return sources.flat();
}

if (import.meta.main) {
	const scriptDirectory = dirname(fileURLToPath(import.meta.url));
	const projectRoot = join(scriptDirectory, "..");
	const root = join(projectRoot, "src", "core");
	const violations = findCoreBoundaryViolations(
		(await collectSources(root)).map((file) => ({
			...file,
			path: relative(projectRoot, file.path),
		})),
	);
	if (violations.length > 0) {
		console.error(violations.join("\n"));
		process.exitCode = 1;
	}
}
