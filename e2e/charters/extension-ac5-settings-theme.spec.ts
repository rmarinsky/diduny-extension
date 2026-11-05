import type { Locator, Page } from "@playwright/test";
import { normalizeLocalBffOrigin } from "../../lib/bff/client";
import { deliveryOrigin } from "../../lib/delivery/site-settings";
import {
	type CharterAction,
	NEW_USER,
	charterSeeds,
	pick,
	walk,
} from "../support/charter";
import { expect, storageGet, test } from "../support/extension-harness";

// Charter AC5 (extension): Settings at its input boundaries and the shared
// theme across open pages, for a keyboard and screen-reader user. Oracles: the
// app's own rules (normalizeLocalBffOrigin, deliveryOrigin) after the
// browser's URL check, exactly one current message per section, and every
// open page agreeing on the stored theme after each toggle.

const ORIGINS = [
	"http://localhost:3000/bff",
	"http://localhost:3000/?q=1",
	"http://localhost:3000/#top",
	"http://user:pass@localhost:3000",
	"https://localhost:3443",
	"http://LOCALHOST:3000",
	"http://localhost:1",
	"http://localhost:65535",
	"http://localhost:0",
	"http://localhost:70000",
	"http://[::1]:3000",
	"http://127.0.0.1:3000",
	"  http://localhost:3000  ",
	"",
	"javascript:alert(1)",
	"ftp://localhost",
	"localhost:3000",
	"http://localhost:3000/",
];

const SITES = [
	"https://Example.COM/path?q=1",
	"http://example.com:80/x",
	"https://example.com:443/",
	"https://пример.рф",
	"https://example.com.",
	"http://localhost:3000/",
	"https://user:pw@example.com",
	"ftp://example.com",
	"file:///C:/x",
	"data:text/plain,hi",
	"example.com",
];

function section(options: Page, heading: string) {
	return options.locator("section", {
		has: options.getByRole("heading", { name: heading }),
	});
}

/** What the browser's own URL check says, or "" when it lets the form submit. */
async function browserRefusal(field: Locator) {
	return field.evaluate((input: HTMLInputElement) =>
		input.validity.valid ? "" : input.validationMessage,
	);
}

test("AC5 extension: Local BFF origin follows the app's rule for every boundary value, with one current message", async ({
	extension,
}) => {
	const { bffUrl, openExtensionPage, worker } = await extension();
	const options = await openExtensionPage("options.html");
	const connection = section(options, "Connection");
	const field = options.getByLabel("Local BFF origin");
	const save = options.getByRole("button", { name: "Save", exact: true });
	let stored = bffUrl;

	for (const value of ORIGINS) {
		await field.fill(value);
		const typed = await field.inputValue();
		const refusal = await browserRefusal(field);
		await save.click();
		await expect(connection.locator("output"), value).toHaveCount(1);
		const message = connection.locator("output");
		if (refusal) await expect(message, value).toHaveText(refusal);
		else {
			let expected: string;
			try {
				expected = normalizeLocalBffOrigin(typed);
			} catch (error) {
				await expect(message, value).toHaveText((error as Error).message);
				expect(await storageGet(worker, "didunyBffOrigin"), value).toBe(stored);
				continue;
			}
			await expect(message, value).toHaveText(
				"Saved. Diduny will use this BFF for the next request.",
			);
			stored = expected;
			await expect(field, value).toHaveValue(expected);
		}
		expect(await storageGet(worker, "didunyBffOrigin"), value).toBe(stored);
	}

	await field.fill(bffUrl);
	await save.click();
	expect(await storageGet(worker, "didunyBffOrigin")).toBe(bffUrl);
});

test("AC5 extension: Disable site lists exactly the origin the app's rule gives, or explains the refusal", async ({
	extension,
}) => {
	const { openExtensionPage } = await extension();
	const options = await openExtensionPage("options.html");
	const sites = section(options, "Sites");
	const field = options.getByLabel("Disable direct delivery on a site");
	const message = sites.locator("output");

	for (const value of SITES) {
		await field.fill(value);
		const refusal = await browserRefusal(field);
		await options.getByRole("button", { name: "Disable site" }).click();
		await expect(message, value).toHaveCount(1);
		const origin = refusal ? null : deliveryOrigin(value);
		if (refusal) await expect(message, value).toHaveText(refusal);
		else if (!origin)
			await expect(message, value).toHaveText(
				"Enter a full http or https site URL.",
			);
		else {
			await expect(message, value).toHaveText(
				`Delivery disabled for ${origin}.`,
			);
			await expect(
				sites.getByRole("listitem").locator("span"),
				value,
			).toHaveText([origin]);
			await sites.getByRole("button", { name: `Enable ${origin}` }).click();
			await expect(message, value).toHaveText(
				`Delivery enabled for ${origin}.`,
			);
		}
		await expect(
			options.getByText("Direct delivery is enabled on every site you allow."),
			value,
		).toBeVisible();
	}
});

interface ThemeModel {
	pages: Page[];
	theme: "dark" | "light";
}

function toggle(page: Page) {
	return page.getByRole("button", { name: /^Switch to (dark|light) theme$/ });
}

const themeActions: CharterAction<ThemeModel>[] = [
	{
		name: "Toggle the theme on one of the open pages",
		weight: 3,
		async run(model, random) {
			const page = pick(random, model.pages);
			await page.bringToFront();
			await toggle(page).click();
			model.theme = model.theme === "dark" ? "light" : "dark";
		},
	},
	{
		name: "Reload one of the open pages",
		async run(model, random) {
			await pick(random, model.pages).reload();
		},
	},
];

for (const seed of charterSeeds())
	test(`AC5 extension: Settings, the side panel and the microphone page agree on the theme, seed ${seed}`, async ({
		extension,
	}, testInfo) => {
		const { openExtensionPage, panel, worker } = await extension({
			colorScheme: "light",
		});
		const model: ThemeModel = {
			pages: [
				await openExtensionPage("options.html"),
				panel,
				await openExtensionPage("mic-permission.html"),
			],
			theme: "light",
		};
		await walk({
			actions: themeActions,
			async check(current) {
				const opposite = current.theme === "dark" ? "light" : "dark";
				for (const page of current.pages) {
					await expect(page.locator("html")).toHaveAttribute(
						"data-theme",
						current.theme,
					);
					await expect(toggle(page)).toHaveAccessibleName(
						`Switch to ${opposite} theme`,
					);
				}
				expect(await storageGet(worker, "didunyTheme")).toBe(current.theme);
			},
			model,
			persona: NEW_USER,
			seed,
			testInfo,
		});
	});
