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
	expect(readme).toContain("merge into protected `main`");
	expect(readme).toContain("protected `main`");
	expect(readme).toContain("does not replace pull-request-only protection");
	expect(readme).toContain("up to 100");
	expect(readme).toMatch(/retains up to 100\s+pending merge runs/);
	expect(readme).toMatch(/Re-run\s+all jobs/);
	expect(readme).toMatch(/`extension-v\*` tags from\s+force-updates/);
});

test("publishes a newly versioned main merge only after browser verification", async () => {
	const workflow = await readProjectFile(
		".github/workflows/extension-release.yml",
	);

	expect(workflow).toContain("push:\n    branches:\n      - main");
	expect(workflow).not.toContain("tags:");
	expect(workflow).not.toContain("pull_request_target");
	expect(workflow).toContain("pull-requests: read");
	expect(workflow).toContain(
		'"/repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/pulls"',
	);
	expect(workflow).toContain(
		'select(.merged_at != null and .base.ref == "main")',
	);
	expect(workflow).toContain(
		"concurrency:\n  group: extension-release-main\n  cancel-in-progress: false\n  queue: max",
	);
	expect(workflow).toContain("npx playwright install --with-deps chromium");
	expect(workflow).toContain("bun run release:extension");
	expect(workflow).toContain('tag="extension-v$version"');
	expect(workflow).toContain('git tag --force "$tag" "$GITHUB_SHA"');
	expect(workflow).toContain('git push origin "refs/tags/$tag"');
	expect(workflow).toContain('git ls-remote --refs origin "refs/tags/$tag"');
	expect(workflow).toContain('gh release create "$tag"');
	expect(workflow).toContain('".output/diduny-extension-$version-chrome.zip"');
	expect(workflow).toContain("--verify-tag");
	expect(workflow).not.toContain("--fail-on-no-commits");
	expect(
		workflow.indexOf("npx playwright install --with-deps chromium"),
	).toBeLessThan(workflow.indexOf("bun run release:extension"));
	expect(workflow.indexOf("bun run release:extension")).toBeLessThan(
		workflow.indexOf('git tag --force "$tag" "$GITHUB_SHA"'),
	);
	expect(workflow.indexOf('git tag --force "$tag" "$GITHUB_SHA"')).toBeLessThan(
		workflow.indexOf('gh release create "$tag"'),
	);
});
