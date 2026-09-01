import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

type Asset = { path: string; source: string };

const inlineScript = /<script\b(?![^>]*\bsrc\s*=)[^>]*>/i;
const evalCall = /\beval\s*\(/;

export function findBuildSecurityViolations(assets: readonly Asset[]) {
	return assets.flatMap(({ path, source }) => [
		...(path.endsWith(".html") && inlineScript.test(source)
			? [`${path}: inline script`]
			: []),
		...(/\.(?:c?js|mjs)$/.test(path) && evalCall.test(source)
			? [`${path}: eval`]
			: []),
	]);
}

async function collectAssets(directory: string): Promise<Asset[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const assets = await Promise.all(
		entries.map(async (entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return collectAssets(path);
			if (!/\.(?:c?js|html|mjs)$/.test(entry.name)) return [];
			return [{ path, source: await readFile(path, "utf8") }];
		}),
	);
	return assets.flat();
}

if (import.meta.main) {
	const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
	const assets = (
		await Promise.all(
			["web/dist", ".output/chrome-mv3"].map((directory) =>
				collectAssets(join(projectRoot, directory)),
			),
		)
	)
		.flat()
		.map((asset) => ({
			...asset,
			path: relative(projectRoot, asset.path),
		}));
	const violations = findBuildSecurityViolations(assets);
	if (violations.length) {
		console.error(violations.join("\n"));
		process.exitCode = 1;
	}
}
