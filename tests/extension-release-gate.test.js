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
	expect(readme).toContain("extension-v<version>");
	expect(readme).toContain("GitHub Release");
});

test("publishes the verified ZIP only for the matching extension version tag", async () => {
	const workflow = await readProjectFile(
		".github/workflows/extension-release.yml",
	);

	expect(workflow).toMatch(/- "extension-v\*"/);
	expect(workflow).toContain("npx playwright install --with-deps chromium");
	expect(workflow).toContain("bun run release:extension");
	expect(workflow).toContain('test "$GITHUB_REF_NAME" = "extension-v$version"');
	expect(workflow).toContain('gh release create "$GITHUB_REF_NAME"');
	expect(workflow).toContain('".output/diduny-extension-$version-chrome.zip"');
	expect(
		workflow.indexOf("npx playwright install --with-deps chromium"),
	).toBeLessThan(workflow.indexOf("bun run release:extension"));
	expect(workflow.indexOf("bun run release:extension")).toBeLessThan(
		workflow.indexOf('gh release create "$GITHUB_REF_NAME"'),
	);
});
