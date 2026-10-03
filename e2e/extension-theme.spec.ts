import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { chromium } from "playwright";

test("extension pages share one theme toggle that persists in chrome.storage", async () => {
	const userDataDir = await mkdtemp(join(tmpdir(), "diduny-theme-e2e-"));
	let context:
		| Awaited<ReturnType<typeof chromium.launchPersistentContext>>
		| undefined;

	try {
		const extensionPath = resolve(".output/chrome-mv3");
		context = await chromium.launchPersistentContext(userDataDir, {
			args: [
				`--disable-extensions-except=${extensionPath}`,
				`--load-extension=${extensionPath}`,
			],
			channel: "chromium",
			colorScheme: "light",
			headless: true,
		});
		const worker =
			context.serviceWorkers()[0] ??
			(await context.waitForEvent("serviceworker", { timeout: 10_000 }));
		const extensionId = new URL(worker.url()).host;
		const base = `chrome-extension://${extensionId}`;

		const options = await context.newPage();
		await options.goto(`${base}/options.html`);
		const root = options.locator("html");
		await expect(root).not.toHaveAttribute("data-theme");
		await expect(
			options.getByRole("button", { name: "Switch to dark theme" }),
		).toHaveAttribute("aria-pressed", "false");

		await options.getByRole("button", { name: "Switch to dark theme" }).click();
		await expect(root).toHaveAttribute("data-theme", "dark");
		expect(
			await options.evaluate(
				() => getComputedStyle(document.documentElement).backgroundColor,
			),
		).toBe("rgb(22, 21, 20)");
		const dark = await new AxeBuilder({ page: options })
			.withTags(["wcag2a", "wcag2aa"])
			.analyze();
		expect(dark.violations).toEqual([]);

		// The choice lives in chrome.storage.local, so every extension page picks it up.
		const stored = await options.evaluate(() =>
			chrome.storage.local.get("didunyTheme"),
		);
		expect(stored.didunyTheme).toBe("dark");

		// Each page starts from the saved theme, then flips it for the next one.
		let theme: "dark" | "light" = "dark";
		for (const page of ["sidepanel.html", "mic-permission.html"]) {
			const next: "dark" | "light" = theme === "dark" ? "light" : "dark";
			const tab = await context.newPage();
			await tab.goto(`${base}/${page}`);
			await expect(tab.locator("html")).toHaveAttribute("data-theme", theme);
			const toggle = tab.getByRole("button", {
				name: `Switch to ${next} theme`,
			});
			await expect(toggle).toHaveAttribute(
				"aria-pressed",
				String(theme === "dark"),
			);
			await toggle.click();
			await expect(tab.locator("html")).toHaveAttribute("data-theme", next);
			await tab.close();
			theme = next;
		}

		await options.reload();
		await expect(root).toHaveAttribute("data-theme", theme);
	} finally {
		await context?.close();
		await rm(userDataDir, { force: true, recursive: true });
	}
});
