import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("keeps the BFF local while allowing command-triggered delivery on the active tab", async () => {
	const [source, background] = await Promise.all([
		readFile("wxt.config.ts", "utf8"),
		readFile("entrypoints/background.ts", "utf8"),
	]);

	expect(source).toContain('"http://localhost/*"');
	expect(source).toContain("optional_host_permissions");
	expect(source).toContain('"activeTab"');
	expect(source).toContain('"https://*/*"');
	expect(source).toContain('"tabCapture"');
	expect(source).not.toContain('"desktopCapture"');
	expect(source).toContain("options_ui");
	expect(source).toContain('"toggle-translation"');
	expect(source).toContain('"start-meeting"');
	expect(background).toContain("chrome.scripting.executeScript");
	expect(background).not.toContain("hasDeliveryPermission");
});
