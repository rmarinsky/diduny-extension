import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const extensionSources = [
	"entrypoints/background.ts",
	"entrypoints/offscreen/main.ts",
	"entrypoints/sidepanel/hooks/useAuth.ts",
	"lib/realtime/ws-client.ts",
	"lib/types.ts",
];

test("the extension never persists or forwards an upstream bearer token", async () => {
	const source = await Promise.all(
		extensionSources.map((path) => readFile(path, "utf8")),
	);
	const joined = source.join("\n");

	expect(joined).not.toContain("supabase");
	expect(joined).not.toContain("accessToken");
	expect(joined).not.toContain("refreshToken");
	expect(joined).not.toContain("?token=");
	expect(joined).not.toContain("Authorization");
});
