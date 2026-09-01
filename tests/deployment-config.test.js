import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
	return readFile(new URL(path, root), "utf8");
}

test("ships a loopback-only compose deployment with persistent local data", async () => {
	const compose = await readProjectFile("compose.yaml");

	expect(compose).toContain('"127.0.0.1:3000:3000"');
	expect(compose).toContain("- diduny-data:/data");
	expect(compose).toMatch(/^volumes:\n\s+diduny-data:/m);
});

test("ships a container, Apache-2.0 license, and CI quality gates", async () => {
	const [dockerfile, license, workflow] = await Promise.all([
		readProjectFile("Dockerfile"),
		readProjectFile("LICENSE"),
		readProjectFile(".github/workflows/ci.yml"),
	]);

	expect(dockerfile).toContain('CMD ["bun", "run", "start:web"]');
	expect(license).toContain("Apache License");
	expect(license).toContain("Version 2.0, January 2004");
	expect(workflow).toContain("bun run lint");
	expect(workflow).toContain("bun run typecheck");
	expect(workflow).toContain("bun run check:core");
	expect(workflow).toContain("bun test");
	expect(workflow).toContain("bun run build");
});
