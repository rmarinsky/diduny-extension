import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
	return readFile(new URL(path, root), "utf8");
}

test("ships a loopback-only compose deployment with persistent local data", async () => {
	const compose = await readProjectFile("compose.yaml");

	expect(compose).toContain('"127.0.0.1:3000:3000"');
	expect(compose).toContain("mock-proxy:");
	expect(compose).toContain('"127.0.0.1:3910:3910"');
	expect(compose).toContain("DIDUNY_UPSTREAM_URL: http://mock-proxy:3910");
	expect(compose).toContain("- diduny-data:/data");
	expect(compose).toMatch(/^volumes:\n\s+diduny-data:/m);
});

test("ships a container, mock proxy, Apache-2.0 license, and CI quality gates", async () => {
	const [dockerfile, license, packageJson, readme, workflow] =
		await Promise.all([
			readProjectFile("Dockerfile"),
			readProjectFile("LICENSE"),
			readProjectFile("package.json"),
			readProjectFile("README.md"),
			readProjectFile(".github/workflows/ci.yml"),
		]);

	expect(dockerfile).toContain('CMD ["bun", "run", "start:web"]');
	expect(dockerfile).toContain("COPY --from=build /app/src ./src");
	expect(dockerfile).toContain("COPY --from=build /app/mock-proxy-main.ts");
	expect(packageJson).toContain('"start:mock-proxy"');
	expect(license).toContain("Apache License");
	expect(license).toContain("Version 2.0, January 2004");
	expect(workflow).toContain("bun run lint");
	expect(workflow).toContain("bun run typecheck");
	expect(workflow).toContain("bun run check:core");
	expect(workflow).toContain("bun test");
	expect(workflow).toContain("bun run build");
	expect(readme).toContain("requires a Diduny account");
	expect(readme).toContain("`DATA_DIR`");
	expect(readme).toContain("Nothing is sent to Diduny maintainers");
	expect(readme).toContain("Never remove the `diduny-data` volume");
	expect(readme).toContain("Browser extension");
});

test("starts only against the configured proxy, without a hidden hosted auth fallback", async () => {
	const startup = await readProjectFile("server-main.ts");

	expect(startup).toContain(
		'process.env.DIDUNY_UPSTREAM_URL ?? "http://127.0.0.1:3910"',
	);
	expect(startup).toContain(
		"new ProxyOtpGateway(globalThis.fetch, upstreamUrl)",
	);
	expect(startup).not.toMatch(/supabase|SUPABASE|https:\/\//i);
});
