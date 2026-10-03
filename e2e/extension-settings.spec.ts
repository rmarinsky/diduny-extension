import type { Page } from "@playwright/test";
import { dictate, expect, storageGet, test } from "./support/extension-harness";

function section(options: Page, heading: string) {
	return options.locator("section", {
		has: options.getByRole("heading", { name: heading }),
	});
}

test("TC-30: Local BFF origin refuses a path, a non-localhost host and invalid input with one current message", async ({
	extension,
}) => {
	const { bffUrl, openExtensionPage, worker } = await extension();
	const options = await openExtensionPage("options.html");
	const connection = section(options, "Connection");
	const field = options.getByLabel("Local BFF origin");
	const save = options.getByRole("button", { name: "Save", exact: true });
	const status = connection.locator("output");
	await expect(field).toHaveValue(bffUrl);

	await field.fill(`${bffUrl}/bff`);
	await save.click();
	await expect(status).toHaveText(
		"BFF origin only; do not include a path or credentials",
	);
	await field.fill("http://127.0.0.1:3000");
	await save.click();
	await expect(status).toHaveText(
		"Extension BFF origin must use localhost for secure cookies",
	);
	expect(await storageGet(worker, "didunyBffOrigin")).toBe(bffUrl);

	// BUG-E17: the old message stayed while the browser blocked the next save.
	for (const value of ["", "not a url"]) {
		await field.fill(value);
		await save.click();
		const reason = await field.evaluate(
			(input: HTMLInputElement) => input.validationMessage,
		);
		expect(reason).not.toBe("");
		await expect(status).toHaveText(reason);
	}

	await field.fill(bffUrl);
	await save.click();
	await expect(status).toHaveText(
		"Saved. Diduny will use this BFF for the next request.",
	);
});

test("TC-31: the default microphone saves, survives a reload, and the next recording works", async ({
	extension,
}) => {
	const session = await extension();
	const { fixture, openExtensionPage } = session;
	const options = await openExtensionPage("options.html");
	const microphone = options.getByLabel("Default microphone");
	const choices = microphone.locator("option");
	await expect(choices.first()).toHaveText("System default");
	await expect.poll(() => choices.count()).toBeGreaterThan(1);
	for (const label of await choices.allTextContents())
		expect(label.trim()).not.toBe("");

	const picked = (await choices.nth(1).textContent()) ?? "";
	await microphone.selectOption({ label: picked });
	await options.getByRole("button", { name: "Save microphone" }).click();
	const saved = section(options, "Microphone").locator("output");
	await expect(saved).toHaveText(
		"Saved. Diduny will use this microphone for the next recording.",
	);
	await expect(saved).toBeInViewport();

	await options.reload();
	await expect(microphone.locator("option:checked")).toHaveText(picked);

	const message = fixture.getByLabel("Message");
	await message.focus();
	await dictate(session);
	await expect(message).toHaveValue(/^Mock transcript \d+$/);
});

test("TC-32: Disable site normalises the URL, refuses non-http URLs, and each Enable button names its site", async ({
	extension,
}) => {
	const { openExtensionPage } = await extension();
	const options = await openExtensionPage("options.html");
	const sites = section(options, "Sites");
	const field = options.getByLabel("Disable direct delivery on a site");
	const disable = options.getByRole("button", { name: "Disable site" });
	const status = sites.locator("output");
	const empty = options.getByText(
		"Direct delivery is enabled on every site you allow.",
	);

	await field.fill("ftp://example.com");
	await disable.click();
	await expect(status).toHaveText("Enter a full http or https site URL.");
	await expect(empty).toBeVisible();

	await field.fill("https://Example.COM/path?q=1");
	await disable.click();
	await expect(status).toHaveText("Delivery disabled for https://example.com.");
	await expect(field).toHaveValue("");
	await field.fill("http://localhost:3000");
	await disable.click();
	await expect(sites.getByRole("listitem").locator("span")).toHaveText([
		"http://localhost:3000",
		"https://example.com",
	]);

	// BUG-E18: both buttons were named just "Enable".
	await expect(
		sites.getByRole("button", { name: "Enable", exact: true }),
	).toHaveCount(0);
	for (const site of ["https://example.com", "http://localhost:3000"]) {
		await sites.getByRole("button", { name: `Enable ${site}` }).click();
		await expect(status).toHaveText(`Delivery enabled for ${site}.`);
	}
	await expect(empty).toBeVisible();
});

test("TC-33: a theme changed in Settings updates the open side panel", async ({
	extension,
}) => {
	const { openExtensionPage, panel, worker } = await extension({
		colorScheme: "light",
	});
	const panelRoot = panel.locator("html");
	await expect(panelRoot).not.toHaveAttribute("data-theme", "dark");
	const options = await openExtensionPage("options.html");
	await options.getByRole("button", { name: "Switch to dark theme" }).click();
	await expect(options.locator("html")).toHaveAttribute("data-theme", "dark");
	expect(await storageGet(worker, "didunyTheme")).toBe("dark");

	// BUG-E14: the open panel stayed light until it was reopened.
	await expect(panelRoot).toHaveAttribute("data-theme", "dark");
	const toggle = panel.getByRole("button", { name: "Switch to light theme" });
	await expect(toggle).toHaveAttribute("aria-pressed", "true");

	await panel.bringToFront();
	await toggle.click();
	await expect(panelRoot).toHaveAttribute("data-theme", "light");
	await expect(options.locator("html")).toHaveAttribute("data-theme", "light");
	await expect(
		options.getByRole("button", { name: "Switch to dark theme" }),
	).toBeVisible();
});
