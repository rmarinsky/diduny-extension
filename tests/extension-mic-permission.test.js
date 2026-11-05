import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("remembers microphone access only after the permission page gets a stream", async () => {
	const [background, offscreen, permissionPage] = await Promise.all([
		readFile("entrypoints/background.ts", "utf8"),
		readFile("entrypoints/offscreen/main.ts", "utf8"),
		readFile("entrypoints/mic-permission/main.ts", "utf8"),
	]);

	// Closing the permission tab must not count as a grant.
	expect(background).not.toMatch(/set\(\{\s*micGranted:\s*true/);
	expect(background).toContain("Microphone access was not granted");
	// A stale grant is dropped when the offscreen document is refused.
	expect(offscreen).toContain('reason: "microphone-blocked"');
	expect(background).toContain('msg.reason === "microphone-blocked"');
	expect(background).toContain(
		"chrome.storage.local.remove(MIC_GRANTED_STORAGE_KEY)",
	);
	expect(permissionPage.indexOf("getUserMedia")).toBeLessThan(
		permissionPage.indexOf("[MIC_GRANTED_STORAGE_KEY]: true"),
	);
});
