import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareBffStartup } from "../src/server/startup";

test("creates a persistent session secret and warns about a non-loopback binding", async () => {
	const dataDir = join(tmpdir(), `diduny-data-${crypto.randomUUID()}`);
	const logs = [];

	const startup = await prepareBffStartup({
		dataDir,
		host: "0.0.0.0",
		log: (record) => logs.push(record),
	});

	expect(startup.dataDir).toBe(dataDir);
	expect(await readFile(startup.sessionSecretPath, "utf8")).not.toHaveLength(0);
	expect(logs).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ event: "startup.data_dir", path: dataDir }),
			expect.objectContaining({ event: "startup.non_loopback_warning" }),
		]),
	);

	await rm(dataDir, { force: true, recursive: true });
});

test("fails fast with the configured path when DATA_DIR is not a writable directory", async () => {
	const dataPath = join(tmpdir(), `diduny-file-${crypto.randomUUID()}`);
	await writeFile(dataPath, "not a directory");

	await expect(
		prepareBffStartup({ dataDir: dataPath, host: "127.0.0.1" }),
	).rejects.toThrow(dataPath);

	await rm(dataPath, { force: true });
});
