import type { Locator, Page } from "@playwright/test";
import {
	dictate,
	dictationDocument,
	dictationStatus,
	expect,
	realtimeConfigs,
	test,
} from "./support/web-workspace";

function pastePanel(page: Page) {
	return page.locator("details.paste-translation");
}

async function openPastePanel(page: Page) {
	await page.getByText("Paste-in translation", { exact: true }).click();
	await expect(page.getByLabel("Text to translate")).toBeVisible();
}

/** The result with the mock's direction tags removed: one tag per translated chunk. */
async function untagged(result: Locator) {
	return ((await result.textContent()) ?? "").replaceAll(" (uk->en)", "");
}

function words(count: number) {
	return Array.from({ length: count }, () => "слово").join(" ");
}

test("TC-07: long pasted text is translated and the previous result is cleared while it runs", async ({
	workspace,
}) => {
	const { page } = await workspace();
	await openPastePanel(page);
	const input = page.getByLabel("Text to translate");
	const translate = page.getByRole("button", { name: "Translate pasted text" });
	const result = page.getByLabel("Translation result");

	await input.fill("Short text");
	await translate.click();
	await expect(result).toHaveText("Short text (uk->en)");
	await expect(
		pastePanel(page).getByText("Pasted text translated."),
	).toBeVisible();

	const medium = words(300);
	await input.fill(medium);
	await translate.click();
	await expect.poll(() => untagged(result)).toBe(medium);
	await expect(result).toHaveText(/\(uk->en\)$/);

	// BUG-W1: about 7,200 characters failed with "The local Diduny process is not reachable" and kept the old result.
	let release: () => void = () => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(
		(url) => url.pathname === "/bff/api/translations",
		async (route) => {
			await released;
			await route.continue();
		},
	);
	const long = words(1200);
	await input.fill(long);
	await translate.click();
	await expect(result).toHaveText("");
	release();
	await expect.poll(() => untagged(result), { timeout: 15_000 }).toBe(long);
	await expect(result).toHaveText(/\(uk->en\)$/);
	await expect(
		pastePanel(page).getByText("Pasted text translated."),
	).toBeVisible();
	await expect(
		page.getByText("The local Diduny process is not reachable", {
			exact: false,
		}),
	).toHaveCount(0);
});

test("TC-08: Settings never saves a translation pair with the same source and target", async ({
	workspace,
}) => {
	const { library, page } = await workspace();
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const source = page.getByLabel("Translation source language");
	const target = page.getByLabel("Translation target language");
	await expect(source).toHaveValue("uk");
	await expect(target).toHaveValue("en");

	// BUG-W2: the target stayed English, so the pair became en -> en.
	await source.selectOption("en");
	await expect(target).toHaveValue("uk");
	await page
		.getByRole("button", { name: "Save translation languages" })
		.click();
	await expect(page.getByText("Translation languages saved.")).toBeVisible();
	expect(library.settings().translationSourceLanguage).toBe("en");
	expect(library.settings().translationTargetLanguage).toBe("uk");

	await target.selectOption("en");
	await expect(source).toHaveValue("uk");

	await page.getByRole("button", { name: "Dictation", exact: true }).click();
	const pair = page.getByRole("group", {
		name: "Translation dictation languages",
	});
	await expect(pair.getByLabel("From")).toHaveValue("en");
	await expect(pair.getByLabel("To")).toHaveValue("uk");
});

test("TC-21: a translation service failure on pasted text is explained in the paste panel and keeps the input", async ({
	workspace,
}) => {
	const { mock, page } = await workspace();
	mock.setBehavior("/api/v1/translations", "server_error");
	await openPastePanel(page);

	await page.getByLabel("Text to translate").fill("Привіт");
	await page.getByRole("button", { name: "Translate pasted text" }).click();
	await expect(
		pastePanel(page).getByText(
			"Could not translate the pasted text. Check the Diduny service and try again.",
		),
	).toBeVisible();
	await expect(page.getByLabel("Text to translate")).toHaveValue("Привіт");
	await expect(page.getByLabel("Translation result")).toHaveText("");
});

test("TC-22: an empty translation shows the language-pair hint", async ({
	workspace,
}) => {
	const { override, page } = await workspace();
	override("GET /api/v1/translations", {
		body: { sentences: [{ trans: "" }] },
	});
	await openPastePanel(page);

	await page.getByLabel("Text to translate").fill("Привіт");
	await page.getByRole("button", { name: "Translate pasted text" }).click();
	await expect(
		pastePanel(page).getByText(
			"The translation returned no text. Check the language pair and try again.",
		),
	).toBeVisible();
});

test("TC-23: translation dictation disables spoken languages and names the language it listens for", async ({
	workspace,
}) => {
	const { mock, page } = await workspace();
	const spoken = ["Українська", "English"].map((name) =>
		page.getByRole("checkbox", { name, exact: true }),
	);
	const hint = page.locator("#language-hints-hint");

	await page.getByRole("checkbox", { name: "Translation dictation" }).check();
	for (const checkbox of spoken) await expect(checkbox).toBeDisabled();
	await expect(hint).toHaveText(
		"Translation dictation listens for Українська, the language you translate from.",
	);

	await dictate(page);
	await expect(dictationStatus(page)).toHaveText(
		"Translation added to this document.",
	);
	// The mock never sends `finished` in translate mode, so the text may come from the HTTP fallback.
	await expect(dictationDocument(page)).toHaveValue(/^Mock transcript \d+$/);
	expect(realtimeConfigs(mock).at(-1)).toMatchObject({
		language_hints: ["uk"],
		mode: "translate",
		translation: { target_language: "en", type: "one_way" },
	});

	await page.getByRole("checkbox", { name: "Translation dictation" }).uncheck();
	for (const checkbox of spoken) await expect(checkbox).toBeEnabled();
	await expect(hint).toHaveText(
		"Nothing ticked: Diduny detects the language itself.",
	);
});
