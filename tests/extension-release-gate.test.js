import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
	return readFile(new URL(path, root), "utf8");
}

test("creates the versioned extension ZIP only after validation and browser activation pass", async () => {
	const [packageJson, readme] = await Promise.all([
		readProjectFile("package.json"),
		readProjectFile("README.md"),
	]);
	const packageManifest = JSON.parse(packageJson);

	expect(packageManifest.scripts["release:extension"]).toBe(
		"bun run validate && bun run test:e2e:extension && bun run zip",
	);
	expect(readme).toContain("bun run release:extension");
	expect(readme).toContain("diduny-extension-<version>-chrome.zip");
});
