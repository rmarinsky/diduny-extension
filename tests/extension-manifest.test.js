import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("keeps the BFF local while allowing command-triggered delivery on the active tab", async () => {
	const [source, background, options] = await Promise.all([
		readFile("wxt.config.ts", "utf8"),
		readFile("entrypoints/background.ts", "utf8"),
		readFile("entrypoints/options/index.html", "utf8"),
	]);

	expect(source).toContain('"http://localhost/*"');
	expect(source).toContain("optional_host_permissions");
	expect(source).toContain('"activeTab"');
	expect(source).toContain('"https://*/*"');
	expect(source).toContain('"tabCapture"');
	expect(source).not.toContain('"desktopCapture"');
	// WXT builds options_ui from the page's meta tags, not from wxt.config.ts.
	expect(options).toContain(
		'<meta name="manifest.open_in_tab" content="true" />',
	);
	expect(source).toContain('"toggle-translation"');
	expect(source).toContain('"start-meeting"');
	expect(background).toContain("chrome.scripting.executeScript");
	expect(background).not.toContain("hasDeliveryPermission");
	// The extension never types into the Diduny web app's own document.
	expect(background).toContain("new URL(tab.url).origin === bffOrigin");
});
