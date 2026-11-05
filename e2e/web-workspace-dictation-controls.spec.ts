import {
	dictate,
	dictationDocument,
	dictationStatus,
	expect,
	reloadWorkspace,
	test,
} from "./support/web-workspace";

test("TC-09: a plain-key shortcut types inside the document and toggles dictation only outside text fields", async ({
	workspace,
}) => {
	const { library, page } = await workspace();
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const pressedModifiers = page
		.getByRole("group", { name: "Toggle dictation" })
		.getByRole("button", { pressed: true });
	while ((await pressedModifiers.count()) > 0)
		await pressedModifiers.first().click();
	await page.getByLabel("Key", { exact: true }).press("d");
	await expect(page.getByText("Preview: D", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Save shortcut" }).click();
	await expect(page.getByText("Shortcut saved: D.")).toBeVisible();
	expect(library.settings().dictationShortcut).toBe("D");

	await page.getByRole("button", { name: "Dictation", exact: true }).click();
	await expect(page.locator(".meter-row .shortcut")).toHaveText(
		"Shortcut: D outside text fields",
	);
	const document = dictationDocument(page);
	await document.focus();
	await page.keyboard.press("d");
	await expect(document).toHaveValue("d");
	await expect(dictationStatus(page)).not.toHaveText("Listening…");

	await document.evaluate((input) => (input as HTMLTextAreaElement).blur());
	await page.keyboard.press("d");
	await expect(dictationStatus(page)).toHaveText("Listening…");
	await expect(page.locator(".meter-row output")).toHaveText("1s");
	await page.keyboard.press("d");
	await expect(document).toHaveValue("d\n---\nMock transcript 1");
	await expect(dictationStatus(page)).toHaveText(
		"Dictation added to this document.",
	);
});

test("TC-10: Settings refuses a reserved shortcut (Ctrl+R) and a shortcut without a key", async ({
	workspace,
}) => {
	const { library, page } = await workspace();
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const key = page.getByLabel("Key", { exact: true });

	await key.press("Control+r");
	await expect(page.getByText("Preview: Ctrl + R")).toBeVisible();
	await page.getByRole("button", { name: "Save shortcut" }).click();
	await expect(
		page.getByText("Ctrl+R is reserved by this browser and cannot be used."),
	).toBeVisible();
	expect(library.settings().dictationShortcut).toBe("Alt+Shift+V");

	await key.press("Backspace");
	await expect(
		page.getByText("Press a key to finish the shortcut."),
	).toBeVisible();
	await page.getByRole("button", { name: "Save shortcut" }).click();
	await expect(page.getByText("Choose a key for the shortcut.")).toBeVisible();
	expect(library.settings().dictationShortcut).toBe("Alt+Shift+V");
});

test("TC-11: a hold-to-record tap shorter than the speech minimum reports no speech and uploads nothing", async ({
	workspace,
}) => {
	const { library, mock, page } = await workspace();
	await dictationDocument(page).fill("Keep");

	await page.getByRole("button", { name: "Hold to record" }).hover();
	await page.mouse.down();
	// The capture double delivers 100 ms frames; speech needs 180 ms (VAD.minimumVoicedDurationMs).
	await page.waitForTimeout(50);
	await page.mouse.up();
	await expect(dictationStatus(page)).toHaveText(
		"No speech detected. Nothing was sent.",
	);
	await expect(dictationDocument(page)).toHaveValue("Keep");
	expect(mock.transcriptions()).toEqual([]);
	expect(library.recordings()).toEqual([]);
});

test("TC-15: starting dictation while another tab records says 'Recording is active in another tab.'", async ({
	workspace,
}) => {
	const { newPage, page: tabA } = await workspace();
	const tabB = await newPage();

	await tabA.bringToFront();
	await tabA.getByRole("button", { name: "Start dictation" }).click();
	await expect(dictationStatus(tabA)).toHaveText("Listening…");

	await tabB.bringToFront();
	await tabB.getByRole("button", { name: "Start dictation" }).click();
	await expect(dictationStatus(tabB)).toHaveText(
		"Recording is active in another tab.",
	);
	await expect(
		tabB.getByRole("button", { name: "Start dictation" }),
	).toBeVisible();

	await tabA.bringToFront();
	await expect(tabA.locator(".meter-row output")).toHaveText(/[1-9]s/);
	await tabA.getByRole("button", { name: "Stop dictation" }).click();
	await expect(dictationDocument(tabA)).toHaveValue("Mock transcript 1");

	await tabB.bringToFront();
	await tabB.getByRole("button", { name: "Start dictation" }).click();
	await expect(dictationStatus(tabB)).toHaveText("Listening…");
});

test("TC-16: Library can't be opened while listening, so no hidden recording or stray transcript", async ({
	workspace,
}) => {
	const { library, mock, page } = await workspace();
	await dictationDocument(page).fill("Keep");

	await page.getByRole("button", { name: "Start dictation" }).click();
	await expect(dictationStatus(page)).toHaveText("Listening…");
	await expect(page.locator(".meter-row output")).toHaveText("1s");
	await expect(
		page.getByRole("button", { name: "Library", exact: true }),
	).toBeDisabled();
	await expect(
		page.getByRole("button", { name: "Settings", exact: true }),
	).toBeDisabled();

	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(dictationStatus(page)).toHaveText("Dictation cancelled.");
	await page.getByRole("button", { name: "Library", exact: true }).click();
	await expect(
		page.getByText("No recordings match your search."),
	).toBeVisible();
	await page.getByRole("button", { name: "Dictation", exact: true }).click();
	await expect(dictationDocument(page)).toHaveValue("Keep");
	expect(mock.transcriptions()).toEqual([]);
	expect(library.recordings()).toEqual([]);

	await dictate(page);
	await expect(dictationDocument(page)).toHaveValue(
		"Keep\n---\nMock transcript 1",
	);
});

test("TC-26: after a reload the shortcut hint never shows the default shortcut before the saved one", async ({
	workspace,
}) => {
	const { page } = await workspace({
		settings: { dictationShortcut: "Alt+V" },
	});
	const hint = page.locator(".meter-row .shortcut");
	await expect(hint).toHaveText("Shortcut: Alt + V");

	// Hold the settings so the page renders before they arrive.
	let release: () => void = () => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/bff/settings", async (route) => {
		if (route.request().method() === "GET") await released;
		await route.continue();
	});
	await page.reload();
	await expect(dictationDocument(page)).toBeVisible();
	// BUG-W5: the hint read "Shortcut: Alt + Shift + V" until settings loaded.
	await expect(hint).not.toContainText("Alt + Shift + V");
	release();
	await expect(hint).toHaveText("Shortcut: Alt + V");

	await page.unroute("**/bff/settings");
	await reloadWorkspace(page);
	await expect(hint).toHaveText("Shortcut: Alt + V");
});
