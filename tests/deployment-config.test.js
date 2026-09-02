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
	const [dockerfile, hooks, license, packageJson, readme, workflow] =
		await Promise.all([
			readProjectFile("Dockerfile"),
			readProjectFile("lefthook.yml"),
			readProjectFile("LICENSE"),
			readProjectFile("package.json"),
			readProjectFile("README.md"),
			readProjectFile(".github/workflows/ci.yml"),
		]);

	expect(dockerfile).toContain('CMD ["bun", "run", "start:web"]');
	expect(dockerfile).toContain("RUN bunx wxt prepare && bun run build:web");
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
	expect(workflow).toContain(
		"zricethezav/gitleaks@sha256:e1b35e12a8c6fa8901f060459cfb6b2fc4c484d3afbe3b029733a3bbfab07055",
	);
	expect(workflow).toContain("fetch-depth: 0");
	expect(workflow).toContain("detect --source=/repo --redact --exit-code=1");
	expect(workflow).toContain("--read-only");
	expect(workflow).toContain('"$PWD:/repo:ro"');
	expect(workflow).not.toContain("GITHUB_TOKEN:");
	expect(hooks).toContain("ripsecrets --strict-ignore {staged_files}");
	expect(hooks).toContain("gitleaks detect --source . --redact");
	expect(packageJson).toContain('"check:build-security"');
	expect(packageJson).toContain("bun run check:build-security");
	expect(readme).toContain("requires a Diduny account");
	expect(readme).toContain("`DATA_DIR`");
	expect(readme).toContain("Nothing is sent to Diduny maintainers");
	expect(readme).toContain("Never remove the `diduny-data` volume");
	expect(readme).toContain("runaway client loop");
	expect(readme).toContain("Browser extension");
	expect(readme).toContain("offline local verification mock");
	expect(readme).toContain("does not authenticate a real Diduny account");
	expect(readme).toContain("DIDUNY_EXTENSION_ORIGIN");
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
