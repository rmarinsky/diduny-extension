import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	mkdir,
	readFile,
	readdir,
	stat,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

export interface StartupRecord {
	event: string;
	path?: string;
	sizeBytes?: number;
}

async function directorySize(path: string): Promise<number> {
	const entries = await readdir(path, { withFileTypes: true });
	const sizes = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = join(path, entry.name);
			return entry.isDirectory()
				? directorySize(entryPath)
				: (await stat(entryPath)).size;
		}),
	);
	return sizes.reduce((total, size) => total + size, 0);
}

function isLoopback(host: string) {
	return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export async function prepareBffStartup({
	dataDir = "data",
	host,
	log = (record: StartupRecord) => console.info(JSON.stringify(record)),
}: {
	dataDir?: string;
	host: string;
	log?: (record: StartupRecord) => void;
}) {
	const resolvedDataDir = resolve(dataDir);
	try {
		await mkdir(resolvedDataDir, { recursive: true });
		await access(resolvedDataDir, constants.R_OK | constants.W_OK);
	} catch {
		throw new Error(`DATA_DIR is not writable: ${resolvedDataDir}`);
	}

	const sessionSecretPath = join(resolvedDataDir, "session-secret");
	try {
		await readFile(sessionSecretPath);
	} catch {
		await writeFile(sessionSecretPath, randomBytes(32).toString("base64url"), {
			mode: 0o600,
		});
	}

	log({
		event: "startup.data_dir",
		path: resolvedDataDir,
		sizeBytes: await directorySize(resolvedDataDir),
	});
	if (!isLoopback(host)) log({ event: "startup.non_loopback_warning" });
	return { dataDir: resolvedDataDir, sessionSecretPath };
}
