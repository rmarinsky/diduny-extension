import {
	clipboardText,
	dictate,
	dictationDocument,
	dictationStatus,
	disableRealtime,
	expect,
	holdTranscriptions,
	test,
} from "./support/web-workspace";

test("TC-01: a transcript is appended at the end with a --- separator whatever the caret or selection", async ({
	workspace,
}) => {
	const { page } = await workspace();
	const document = dictationDocument(page);

	await document.fill("START END");
	await document.evaluate((input: HTMLTextAreaElement) =>
		input.setSelectionRange(6, 6),
	);
	await dictate(page);
	const appended = "START END\n---\nMock transcript 1";
	await expect(document).toHaveValue(appended);
	await expect(dictationStatus(page)).toHaveText(
		"Dictation added to this document.",
	);
	await expect(document).toBeFocused();
	expect(
		await document.evaluate((input: HTMLTextAreaElement) => [
			input.selectionStart,
			input.selectionEnd,
		]),
	).toEqual([appended.length, appended.length]);

	await document.fill("KEEP REPLACE-ME KEEP");
	await document.evaluate((input: HTMLTextAreaElement) =>
		input.setSelectionRange(5, 15),
	);
	await dictate(page);
	await expect(document).toHaveValue(
		"KEEP REPLACE-ME KEEP\n---\nMock transcript 2",
	);
});

test("TC-02: text typed while listening and while transcribing is kept and the transcript goes after it", async ({
	workspace,
}) => {
	const { mock, page } = await workspace();
	disableRealtime(mock);
	const release = await holdTranscriptions(page);
	const document = dictationDocument(page);
	await document.fill("Base");

	await page.getByRole("button", { name: "Start dictation" }).click();
	await expect(dictationStatus(page)).toHaveText("Listening…");
	await expect(document).toBeEditable();
	await document.focus();
	await page.keyboard.press("Control+End");
	await page.keyboard.type(" typed-while-listening");
	await expect(document).toHaveValue("Base typed-while-listening");
	await expect(dictationStatus(page)).toHaveText("Listening…");

	await expect(page.locator(".meter-row output")).toHaveText("1s");
	await page.getByRole("button", { name: "Stop dictation" }).click();
	await expect(dictationStatus(page)).toHaveText(
		"Realtime is unavailable. Transcribing the completed recording…",
	);
	await document.focus();
	await page.keyboard.press("Control+End");
	await page.keyboard.type(" typed-after-stop");
	await expect(document).toHaveValue(
		"Base typed-while-listening typed-after-stop",
	);

	release();
	await expect(document).toHaveValue(
		"Base typed-while-listening typed-after-stop\n---\nMock transcript 1",
	);
});

test("TC-03: after clicking Stop the user keeps typing into the document without losing keystrokes", async ({
	workspace,
}) => {
	const { mock, page } = await workspace();
	disableRealtime(mock);
	const release = await holdTranscriptions(page);
	const document = dictationDocument(page);
	await document.fill("Base");

	await page.getByRole("button", { name: "Start dictation" }).click();
	await expect(page.locator(".meter-row output")).toHaveText("1s");
	await page.getByRole("button", { name: "Stop dictation" }).click();
	await expect(dictationStatus(page)).toHaveText(
		"Realtime is unavailable. Transcribing the completed recording…",
	);
	// BUG-W4: focus fell to the page body while transcribing.
	await expect(document).toBeFocused();
	await page.keyboard.type(" after");
	await expect(document).toHaveValue("Base after");

	release();
	await expect(document).toHaveValue("Base after\n---\nMock transcript 1");
	await expect(document).toBeFocused();
});

test("TC-04: Clear can be undone with Ctrl+Z, so typed text is not lost", async ({
	workspace,
}) => {
	const { page } = await workspace({ retention: { dictation: "never" } });
	const document = dictationDocument(page);
	await document.pressSequentially("Important paragraph");
	await expect(page.getByRole("button", { name: "Copy" })).toBeEnabled();
	await expect(page.getByRole("button", { name: "Clear" })).toBeEnabled();

	await page.getByRole("button", { name: "Clear" }).click();
	await expect(document).toHaveValue("");
	await expect(dictationStatus(page)).toHaveText("Document cleared.");

	// BUG-W3: the cleared text could not be restored.
	await document.focus();
	await page.keyboard.press("Control+Z");
	await expect(document).toHaveValue("Important paragraph");
	await expect(page.getByRole("button", { name: "Clear" })).toBeEnabled();
});

test("TC-17: Ukrainian and multi-line transcripts are appended unchanged", async ({
	workspace,
}) => {
	const { mock, override, page } = await workspace();
	const transcript = "Привіт, світе! Як справи?\nДругий рядок";
	disableRealtime(mock);
	override("POST /api/v1/transcriptions", {
		body: { text: transcript, tokens: [] },
	});
	const document = dictationDocument(page);

	await document.fill("Нотатка:");
	await dictate(page);
	await expect(document).toHaveValue(`Нотатка:\n---\n${transcript}`);

	await page.getByRole("button", { name: "Copy" }).click();
	await expect(dictationStatus(page)).toHaveText("Copied to clipboard.");
	await expect
		.poll(() => clipboardText(page))
		.toBe(`Нотатка:\n---\n${transcript}`);
});

test("TC-25: Copy and Clear are disabled for an empty document and Copy writes exactly the document", async ({
	workspace,
}) => {
	const { page } = await workspace();
	const document = dictationDocument(page);
	const copy = page.getByRole("button", { name: "Copy" });
	const clear = page.getByRole("button", { name: "Clear" });
	await page.evaluate(() => navigator.clipboard.writeText("PRE-EXISTING"));

	await document.fill("");
	await expect(copy).toBeDisabled();
	await expect(clear).toBeDisabled();
	expect(await clipboardText(page)).toBe("PRE-EXISTING");

	await document.focus();
	await page.keyboard.type("Line 1");
	await page.keyboard.press("Enter");
	await page.keyboard.type("Line 2");
	await expect(copy).toBeEnabled();
	await expect(clear).toBeEnabled();

	await copy.click();
	await expect(dictationStatus(page)).toHaveText("Copied to clipboard.");
	await expect.poll(() => clipboardText(page)).toBe("Line 1\nLine 2");

	await clear.click();
	await expect(dictationStatus(page)).toHaveText("Document cleared.");
	await expect(document).toHaveValue("");
	await expect(document).toBeFocused();
	await expect(clear).toBeDisabled();
});
