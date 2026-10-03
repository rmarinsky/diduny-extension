import type { Page } from "@playwright/test";
import {
	TEST_EMAIL,
	clipboardText,
	dictate,
	dictationDocument,
	dictationStatus,
	expect,
	reloadWorkspace,
	test,
} from "./support/web-workspace";
import { seededRecording } from "./support/workspace-library";

const cleanupSaved =
	"Cleanup settings saved. New library views and copies use this text.";

function fillerField(page: Page) {
	return page.getByRole("textbox", { name: "Filler words to remove" });
}

function fillerChips(page: Page) {
	return page
		.getByRole("list", { name: "Filler words to remove" })
		.getByRole("listitem");
}

async function addFillers(page: Page, ...terms: string[]) {
	for (const term of terms) {
		await fillerField(page).pressSequentially(term);
		await fillerField(page).press("Enter");
	}
}

async function dictateIntoLibrary(page: Page, recordings: () => unknown[]) {
	await dictate(page);
	await expect(dictationDocument(page)).toHaveValue("Mock transcript 1");
	await expect.poll(() => recordings().length).toBe(1);
}

/**
 * Visible English-looking words on the page: text nodes, labels and
 * placeholders with three or more Latin letters, minus the allowed words.
 */
function englishWords(page: Page, allowed: readonly string[]) {
	return page.evaluate((allowedWords) => {
		const found = new Set<string>();
		const check = (value: string | null) => {
			for (const word of value?.match(/[A-Za-z]{3,}/g) ?? [])
				if (!allowedWords.includes(word)) found.add(word);
		};
		const walker = document.createTreeWalker(
			document.body,
			NodeFilter.SHOW_TEXT,
		);
		while (walker.nextNode()) {
			const element = walker.currentNode.parentElement;
			if (!element?.checkVisibility()) continue;
			// Language names are written in their own language, marked with lang.
			if (element.closest("[lang]:not(html)")) continue;
			check(walker.currentNode.textContent);
		}
		for (const element of document.querySelectorAll<HTMLElement>(
			"[aria-label], [placeholder], [title]",
		)) {
			if (!element.checkVisibility()) continue;
			check(element.getAttribute("aria-label"));
			check(element.getAttribute("placeholder"));
			check(element.getAttribute("title"));
		}
		return [...found].sort();
	}, allowed);
}

test("TC-31: every Settings save shows its confirmation in view, next to the saved section", async ({
	workspace,
}) => {
	const { page } = await workspace({ viewport: { height: 945, width: 1920 } });
	await page.getByRole("button", { name: "Settings", exact: true }).click();

	await addFillers(page, "like");
	await page.getByRole("button", { name: "Save cleanup" }).click();
	const cleanupMessage = page
		.getByRole("region", { name: "Transcript cleanup" })
		.getByText(cleanupSaved);
	// BUG-W8: the confirmation was the page's last element, far below the fold.
	await expect(cleanupMessage).toBeInViewport({ ratio: 1 });

	await page
		.getByRole("button", { name: "Save accessibility settings" })
		.click();
	await expect(
		page
			.getByRole("region", { name: "Accessibility" })
			.getByText("Accessibility setting saved."),
	).toBeInViewport({ ratio: 1 });
	await expect(page.getByText(cleanupSaved)).toHaveCount(0);

	await page.getByRole("button", { name: "Reset settings" }).click();
	await page
		.getByRole("dialog", { name: "Reset settings?" })
		.getByRole("button", { name: "Reset settings" })
		.click();
	await expect(page.getByText("Settings reset to defaults.")).toBeInViewport({
		ratio: 1,
	});
	await expect(page.getByText("Accessibility setting saved.")).toHaveCount(0);
});

test("TC-32: cleanup words change Library text and copies but not the document or the history", async ({
	workspace,
}) => {
	const { library, page } = await workspace({
		retention: { dictation: "days7" },
	});
	await dictateIntoLibrary(page, library.recordings);
	await page.getByRole("button", { name: "Settings", exact: true }).click();

	await addFillers(page, "like", "UM");
	await fillerField(page).pressSequentially("so,");
	await expect(fillerChips(page)).toHaveText([/^um/, /^uh/, /^like/, /^so/]);
	await expect(fillerField(page)).toHaveValue("");
	await fillerField(page).press("Backspace");
	await page.getByRole("button", { name: "Remove like" }).click();
	await expect(fillerChips(page)).toHaveText([/^um/, /^uh/]);

	// A typed word that was never confirmed with Enter is saved too.
	await fillerField(page).fill("transcript");
	await page.getByRole("button", { name: "Save cleanup" }).click();
	await expect(page.getByText(cleanupSaved)).toBeVisible();
	expect(library.settings().fillerWords).toEqual(["um", "uh", "transcript"]);
	await reloadWorkspace(page);
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await expect(fillerChips(page)).toHaveText([/^um/, /^uh/, /^transcript/]);

	await page.getByRole("button", { name: "Library", exact: true }).click();
	await page
		.getByRole("list", { name: "Library recordings" })
		.getByRole("button")
		.first()
		.click();
	await expect(page.getByLabel("Transcript", { exact: true })).toHaveText(
		"Mock 1",
	);
	await page.getByRole("button", { name: "Copy transcript" }).click();
	await expect.poll(() => clipboardText(page)).toBe("Mock 1");
	await expect(
		page.getByRole("region", { name: "Transcript history" }),
	).toContainText("Mock transcript 1");
	await page.getByRole("button", { name: "Dictation", exact: true }).click();
	await expect(dictationDocument(page)).toHaveValue("Mock transcript 1");

	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const keep = page.getByRole("textbox", { name: "Phrases to keep" });
	await keep.fill("Mock transcript");
	await keep.press("Enter");
	await page.getByRole("button", { name: "Save cleanup" }).click();
	await expect(page.getByText(cleanupSaved)).toBeVisible();
	await page.getByRole("button", { name: "Library", exact: true }).click();
	await page
		.getByRole("list", { name: "Library recordings" })
		.getByRole("button")
		.first()
		.click();
	await expect(page.getByLabel("Transcript", { exact: true })).toHaveText(
		"Mock transcript 1",
	);
});

test("TC-33: dictation statistics use the singular and plural word forms", async ({
	workspace,
}) => {
	const { library, page } = await workspace({
		retention: { dictation: "days7" },
	});
	await dictateIntoLibrary(page, library.recordings);
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const statistics = page.getByRole("region", { name: "Dictation statistics" });

	await addFillers(page, "transcript");
	await page.getByRole("button", { name: "Save cleanup" }).click();
	await expect(statistics).toContainText("2 visible dictation words.");

	// BUG-W9: it said "1 visible dictation words."
	await addFillers(page, "mock");
	await page.getByRole("button", { name: "Save cleanup" }).click();
	await expect(statistics).toContainText("1 visible dictation word.");
	await expect(statistics).not.toContainText("1 visible dictation words.");
});

test("TC-34: the Ukrainian interface applies to every visible text and survives a reload", async ({
	workspace,
}) => {
	const { page } = await workspace({
		recordings: [
			seededRecording({
				id: "c0ffee00-0000-4000-8000-000000000034",
				text: "Привіт з бібліотеки",
			}),
		],
	});
	// Brand, account, key names, the English language name and the transcript's
	// provider id ("cloud", shown in the history) are names, not UI text to translate.
	const allowed = [
		"Diduny",
		...TEST_EMAIL.split(/[^A-Za-z]+/),
		"Alt",
		"Shift",
		"Ctrl",
		"Meta",
		"Win",
		"Enter",
		"English",
		"cloud",
	];

	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await page
		.getByRole("combobox", { name: "Interface language" })
		.selectOption("uk");
	await page.getByRole("button", { name: "Save interface language" }).click();
	await expect(page.getByText("Мову інтерфейсу збережено.")).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("lang", "uk");
	expect(await englishWords(page, allowed)).toEqual([]);

	await page.getByRole("button", { name: "Диктування" }).click();
	expect(await englishWords(page, allowed)).toEqual([]);
	await page.getByRole("button", { name: "Бібліотека" }).click();
	await expect(
		page.getByRole("list", { name: /./ }).getByRole("button").first(),
	).toBeVisible();
	expect(await englishWords(page, allowed)).toEqual([]);
	await page
		.getByRole("list", { name: /./ })
		.getByRole("button")
		.first()
		.click();
	await expect(page.getByText("Привіт з бібліотеки").first()).toBeVisible();
	expect(await englishWords(page, allowed)).toEqual([]);
	await page.getByRole("button", { name: "Про доставку тексту" }).click();
	expect(await englishWords(page, allowed)).toEqual([]);
	await page.getByRole("button", { name: "Вийти", exact: true }).click();
	await expect(
		page.getByRole("dialog", { name: "Вийти з Diduny?" }),
	).toBeVisible();
	expect(await englishWords(page, allowed)).toEqual([]);
	await page.getByRole("button", { name: "Залишитися в системі" }).click();
	await page.getByRole("button", { name: "Диктування" }).click();

	// BUG-W11: after a reload the status still said "Ready to dictate."
	await reloadWorkspace(page);
	const navigation = page.getByRole("navigation");
	await expect(navigation.getByRole("button")).toHaveText([
		"Диктування",
		"Бібліотека",
		"Налаштування",
	]);
	await expect(dictationStatus(page)).toHaveText("Готово до диктування.");
	expect(await englishWords(page, allowed)).toEqual([]);

	await page.getByRole("button", { name: "Налаштування" }).click();
	await page
		.getByRole("combobox", { name: "Мова інтерфейсу" })
		.selectOption("en");
	await page.getByRole("button", { name: "Зберегти мову інтерфейсу" }).click();
	await expect(page.getByText("Interface language saved.")).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("TC-35: Reset settings asks first, lists what it resets, and keeps retention", async ({
	workspace,
}) => {
	const { library, page } = await workspace({
		microphones: { permission: "granted" },
		retention: { dictation: "days7", meeting: "forever" },
		settings: {
			announceLiveTranscript: true,
			dictationShortcut: "Alt+V",
			fillerWords: ["um", "uh", "like"],
			microphoneDeviceId: "usb",
			speechLanguageHints: ["uk", "en"],
			typingSpeedWordsPerMinute: 130,
		},
	});
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const reset = page.getByRole("button", { name: "Reset settings" });
	const dialog = page.getByRole("dialog", { name: "Reset settings?" });

	await reset.click();
	await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await expect(reset).toBeFocused();

	await reset.click();
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(dialog).toHaveCount(0);
	await expect(reset).toBeFocused();
	expect(library.settings().fillerWords).toEqual(["um", "uh", "like"]);

	await reset.click();
	// BUG-W12: the dialog did not say that spoken languages are reset too.
	await expect(dialog).toContainText("spoken languages");
	await dialog.getByRole("button", { name: "Reset settings" }).click();
	await expect(page.getByText("Settings reset to defaults.")).toBeVisible();
	await expect(fillerChips(page)).toHaveText([/^um/, /^uh/]);
	await expect(
		page.getByLabel("Announce final live transcript"),
	).not.toBeChecked();
	await expect(page.getByLabel("Recording microphone")).toHaveValue("");
	await expect(page.getByText("Preview: Alt + Shift + V")).toBeVisible();
	await expect(page.getByLabel("Translation source language")).toHaveValue(
		"uk",
	);
	await expect(page.getByLabel("Translation target language")).toHaveValue(
		"en",
	);
	await expect(
		page.getByLabel("Your typing speed, words per minute"),
	).toHaveValue("40");
	await expect(page.getByLabel("Dictation and translation")).toHaveValue(
		"days7",
	);
	await expect(page.getByLabel("Meetings")).toHaveValue("forever");
	await expect(reset).toBeFocused();

	await page.getByRole("button", { name: "Dictation", exact: true }).click();
	await expect(
		page.getByRole("checkbox", { name: "Українська", exact: true }),
	).toBeChecked();
	await expect(
		page.getByRole("checkbox", { name: "English", exact: true }),
	).not.toBeChecked();
});

test("TC-36: the typing test only counts the shown sentence and typing speed refuses out-of-range values", async ({
	workspace,
}) => {
	const { library, page } = await workspace();
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const sentence = "Clear ideas deserve calm words and careful attention.";
	const typingTest = page.getByRole("textbox", { name: "Typing test" });
	const saveMeasured = page.getByRole("button", {
		name: "Save measured speed",
	});
	const speed = page.getByLabel("Your typing speed, words per minute");

	await typingTest.fill(sentence);
	await saveMeasured.click();
	await expect(
		page.getByText("Type the sentence before saving your measured speed."),
	).toBeVisible();

	await typingTest.fill("");
	await typingTest.pressSequentially(sentence, { delay: 5 });
	await saveMeasured.click();
	await expect(
		page.getByText(
			"That is faster than 300 words per minute. Type the sentence instead of pasting it.",
		),
	).toBeVisible();

	await typingTest.fill("");
	await typingTest.pressSequentially(sentence, { delay: 90 });
	await saveMeasured.click();
	await expect(
		page.getByText(/^Measured \d+ words per minute and saved it\.$/),
	).toBeVisible();
	const measured = library.settings().typingSpeedWordsPerMinute ?? 0;
	expect(measured).toBeGreaterThanOrEqual(40);
	expect(measured).toBeLessThanOrEqual(150);
	await expect(speed).toHaveValue(String(measured));
	await expect(typingTest).toHaveValue("");

	// BUG-W13: any text was measured and saved.
	await typingTest.pressSequentially("asdf qwer zxcv", { delay: 90 });
	await saveMeasured.click();
	await expect(
		page.getByText("Type the sentence exactly as shown to measure your speed."),
	).toBeVisible();
	expect(library.settings().typingSpeedWordsPerMinute).toBe(measured);

	for (const value of ["0", "301", "1.5"]) {
		await speed.fill(value);
		await page.getByRole("button", { name: "Save typing speed" }).click();
		expect(
			await speed.evaluate((input: HTMLInputElement) => input.validity.valid),
		).toBe(false);
		expect(library.settings().typingSpeedWordsPerMinute).toBe(measured);
	}
	await speed.fill("");
	await page.getByRole("button", { name: "Save typing speed" }).click();
	await expect(
		page.getByText("Enter a typing speed between 1 and 300 words per minute."),
	).toBeVisible();
	await speed.fill("300");
	await page.getByRole("button", { name: "Save typing speed" }).click();
	await expect(page.getByText("Typing speed saved.")).toBeVisible();
	expect(library.settings().typingSpeedWordsPerMinute).toBe(300);
});

test("TC-37: accessibility, microphone and meetings retention are saved and survive a reload", async ({
	workspace,
}) => {
	const { library, page } = await workspace({
		microphones: { permission: "granted" },
	});
	await page.getByRole("button", { name: "Settings", exact: true }).click();

	await page.getByLabel("Announce final live transcript").check();
	await page
		.getByRole("button", { name: "Save accessibility settings" })
		.click();
	await expect(page.getByText("Accessibility setting saved.")).toBeVisible();

	const microphone = page.getByRole("region", { name: "Microphone" });
	await microphone
		.getByRole("button", { name: "Refresh microphone devices" })
		.click();
	await expect(
		microphone.getByLabel("Recording microphone").locator("option"),
	).toHaveText([
		"Browser default microphone",
		"Built-in Microphone",
		"USB Microphone",
	]);
	await microphone.getByLabel("Recording microphone").selectOption("usb");
	await expect(
		microphone.getByText("Microphone preference saved."),
	).toBeVisible();

	await page.getByLabel("Meetings").selectOption("days30");
	await expect(page.getByText("Retention policy saved.")).toBeVisible();
	expect(library.retention().meeting).toBe("days30");

	await reloadWorkspace(page);
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await expect(page.getByLabel("Announce final live transcript")).toBeChecked();
	await expect(page.getByLabel("Recording microphone")).toHaveValue("usb");
	await expect(page.getByLabel("Meetings")).toHaveValue("days30");
});
