import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { chromium } from "playwright";

test("installs the built extension and activates its MV3 runtime in Chromium", async () => {
	const userDataDir = await mkdtemp(
		join(tmpdir(), "diduny-extension-install-"),
	);
	const extensionPath = resolve(".output/chrome-mv3");
	let context:
		| Awaited<ReturnType<typeof chromium.launchPersistentContext>>
		| undefined;

	try {
		context = await chromium.launchPersistentContext(userDataDir, {
			args: [
				`--disable-extensions-except=${extensionPath}`,
				`--load-extension=${extensionPath}`,
			],
			channel: "chromium",
			headless: true,
		});
		const worker =
			context.serviceWorkers()[0] ??
			(await context.waitForEvent("serviceworker", { timeout: 10_000 }));
		const extensionId = new URL(worker.url()).host;
		await context.route(
			"http://localhost:3000/bff/extension/auth/session",
			(route) =>
				route.fulfill({
					body: JSON.stringify({ authenticated: false }),
					contentType: "application/json",
				}),
		);

		const options = await context.newPage();
		await options.goto(`chrome-extension://${extensionId}/options.html`);
		await expect(
			options.getByRole("heading", { name: "Diduny settings" }),
		).toBeVisible();
		expect(await options.evaluate(() => chrome.runtime.id)).toBe(extensionId);
		expect(
			await options.evaluate(() => chrome.runtime.getManifest()),
		).toMatchObject({
			manifest_version: 3,
			name: "Diduny",
		});
		expect(
			await options.evaluate(
				() =>
					new Promise((resolve) =>
						chrome.runtime.sendMessage({ type: "getBffSession" }, resolve),
					),
			),
		).toEqual({ authenticated: false });
	} finally {
		await context?.close();
		await rm(userDataDir, { force: true, recursive: true });
	}
});
