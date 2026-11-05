import {
	TEST_EMAIL,
	clickRecord,
	dictate,
	expect,
	panelTranscript,
	stateLabel,
	test,
} from "./support/extension-harness";

test("TC-04: the Transcript survives closing and reopening the side panel", async ({
	extension,
}) => {
	const session = await extension();
	const { fixture, panel, worker } = session;
	await fixture.getByLabel("Message").focus();
	await dictate(session);
	const transcript = panelTranscript(panel);
	await expect(transcript).toHaveValue(/^Mock transcript \d+$/);
	const result = await transcript.inputValue();

	await panel.bringToFront();
	await transcript.click();
	await panel.keyboard.press("End");
	await panel.keyboard.type(" edited");
	await expect(transcript).toHaveValue(`${result} edited`);
	// The draft is saved as it changes; wait for the save before closing the panel.
	await expect
		.poll(() =>
			worker.evaluate(
				async () =>
					(await chrome.storage.session.get("didunyPanelTranscript"))
						.didunyPanelTranscript,
			),
		)
		.toMatchObject({ micText: `${result} edited` });

	// BUG-E5: the reopened panel's Transcript was empty.
	await panel.reload();
	await expect(panel.getByText(TEST_EMAIL)).toBeVisible();
	await expect(transcript).toHaveValue(`${result} edited`);
});

test("TC-07: Clear can be undone with Ctrl+Z, and focus stays in the panel", async ({
	extension,
}) => {
	const session = await extension();
	const { fixture, panel } = session;
	const transcript = panelTranscript(panel);
	await panel.bringToFront();
	await transcript.fill("Typed in the panel");
	await fixture.getByLabel("Message").focus();
	await dictate(session);
	await expect(transcript).toHaveValue(
		/^Typed in the panel\n---\nMock transcript \d+$/,
	);
	const before = await transcript.inputValue();

	// BUG-E9: Clear dropped focus to the page and Ctrl+Z brought back an older text.
	await panel.bringToFront();
	await panel.getByRole("button", { name: "Clear" }).click();
	await expect(transcript).toHaveValue("");
	await expect(panel.getByRole("button", { name: "Copy" })).toBeHidden();
	await expect(panel.getByRole("button", { name: "Clear" })).toBeHidden();
	await expect(transcript).toBeFocused();

	await panel.keyboard.press("Control+Z");
	await expect(transcript).toHaveValue(before);
});

test("TC-08: text typed into the Transcript during a recording is kept and the result lands below it", async ({
	extension,
}) => {
	const session = await extension();
	const { fixture, panel } = session;
	const transcript = panelTranscript(panel);
	const message = fixture.getByLabel("Message");
	await panel.bringToFront();
	await transcript.fill("Before");

	await fixture.bringToFront();
	await message.focus();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect(transcript).toBeEditable();
	await panel.bringToFront();
	await transcript.click();
	await panel.keyboard.press("End");
	await panel.keyboard.type(" typed while recording");
	await expect(transcript).toHaveValue("Before typed while recording");

	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	await expect(transcript).toHaveValue(
		/^Before typed while recording\n---\nMock transcript \d+$/,
	);
	await expect(message).toHaveValue(/^Mock transcript \d+$/);
});

test("TC-09: the Transcript shows the newest result after each dictation", async ({
	extension,
}) => {
	const session = await extension();
	const { fixture, panel } = session;
	const transcript = panelTranscript(panel);
	const earlier = Array.from(
		{ length: 12 },
		(_, index) => `Earlier result ${index + 1}`,
	).join("\n---\n");
	await panel.bringToFront();
	await transcript.fill(earlier);
	await transcript.evaluate((field) => {
		field.scrollTop = 0;
	});
	const scroll = () =>
		transcript.evaluate((field) => ({
			client: field.clientHeight,
			height: field.scrollHeight,
			top: field.scrollTop,
		}));
	const top = await scroll();
	expect(top.top).toBe(0);
	expect(top.height).toBeGreaterThan(top.client);

	await fixture.getByLabel("Message").focus();
	await dictate(session);
	await expect(transcript).toHaveValue(/\n---\nMock transcript \d+$/);
	// BUG-E19: the box stayed at the oldest lines, so the new result was out of view.
	await expect
		.poll(async () => {
			const { client, height, top: scrolled } = await scroll();
			return height - (scrolled + client);
		})
		.toBeLessThanOrEqual(2);
});

test("TC-10: Copy writes the whole Transcript and shows 'Copied!' for about 2 seconds", async ({
	extension,
}) => {
	const { fixture, panel } = await extension();
	const text = "Mock transcript 1\n---\nMock transcript 2";
	await panel.bringToFront();
	await panelTranscript(panel).fill(text);
	await panel.getByRole("button", { name: "Copy" }).click();
	await expect(panel.getByRole("button", { name: "Copied!" })).toBeVisible();
	await panel.waitForTimeout(2_500);
	await expect(panel.getByRole("button", { name: "Copy" })).toBeVisible();

	await fixture.bringToFront();
	const message = fixture.getByLabel("Message");
	await message.focus();
	await fixture.keyboard.press("Control+V");
	await expect(message).toHaveValue(text);
});
