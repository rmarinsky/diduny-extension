import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("declares local BFF access without broad host permissions", async () => {
	const source = await readFile("wxt.config.ts", "utf8");

	expect(source).toContain('"http://localhost/*"');
	expect(source).not.toContain("optional_host_permissions");
	expect(source).toContain("options_ui");
});
