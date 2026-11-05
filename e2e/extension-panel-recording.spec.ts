import type { Locator, Page } from "@playwright/test";
import {
	TEST_EMAIL,
	backgroundMessage,
	badgeText,
	clickRecord,
	deliveryNotice,
	dictate,
	expect,
	liveBox,
	panelTranscript,
	readStateTrail,
	realtimeConfigs,
	recordButton,
	stateLabel,
	test,
	watchStateTrail,
} from "./support/extension-harness";

function token(text: string, isFinal: boolean) {
	return { confidence: 1, end_ms: 0, is_final: isFinal, start_ms: 0, text };
}

/** toBeVisible() also passes below the fold; the box itself must be inside the window. */
async function expectInViewport(page: Page, locator: Locator) {
	const box = await locator.boundingBox();
	const viewport = page.viewportSize();
	if (!box || !viewport) throw new Error("Expected a rendered element");
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

test("TC-03: reopening the panel during a recording shows the running recording, and Stop keeps all of its text", async ({
	extension,
}) => {
	const session = await extension();
	const { fixture, mock, panel, worker } = session;
	const message = fixture.getByLabel("Message");
	await message.focus();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect.poll(() => badgeText(worker)).toBe("●");
	await expect
		.poll(() => mock.realtimeFrames().some((frame) => frame.isBinary))
		.toBe(true);

	// BUG-E3: the reopened panel said Ready, and Record started a second capture.
	await panel.reload();
	await expect(panel.getByText(TEST_EMAIL)).toBeVisible();
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect(recordButton(panel)).toHaveAccessibleName("Stop recording");
	await expect(liveBox(panel)).toBeVisible();

	await fixture.bringToFront();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	await expect(message).toHaveValue(/^Mock transcript \d+$/);
	await expect(panelTranscript(panel)).toHaveValue(await message.inputValue());
	expect(realtimeConfigs(mock)).toHaveLength(1);
});

test("TC-06: the live box keeps final text, replaces provisional text and strips end tags; only the final result reaches the Transcript", async ({
	extension,
}) => {
	const session = await extension();
	const { fixture, panel, worker } = session;
	await fixture.getByLabel("Message").focus();
	await dictate(session);
	const transcript = panelTranscript(panel);
	await expect(transcript).toHaveValue(/^Mock transcript \d+$/);
	const first = await transcript.inputValue();

	const finalText = liveBox(panel).getByTestId("live-final-text");
	const provisionalText = liveBox(panel).getByTestId("live-provisional-text");
	await watchStateTrail(panel);
	const release = session.holdSaves();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Recording...");

	await backgroundMessage(worker, {
		source: "mic",
		tokens: [token(" Live ", true), token("words", false)],
		type: "realtime-tokens",
	});
	await expect.poll(() => finalText.textContent()).toBe(" Live ");
	await expect(provisionalText).toHaveText("words");
	await expect(transcript).toHaveValue(first);

	await backgroundMessage(worker, {
		source: "mic",
		tokens: [token("more<end>", true)],
		type: "realtime-tokens",
	});
	await expect.poll(() => finalText.textContent()).toBe(" Live more");
	await expect.poll(() => provisionalText.textContent()).toBe("");

	await backgroundMessage(worker, {
		source: "mic",
		tokens: [token("next guess", false)],
		type: "realtime-tokens",
	});
	await expect(provisionalText).toHaveText("next guess");
	await expect.poll(() => finalText.textContent()).toBe(" Live more");

	// The library save is held, so the panel stays on Processing with the live box.
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Processing...");
	await expect(liveBox(panel)).toBeVisible();
	await expect(recordButton(panel)).toBeDisabled();
	await expect(recordButton(panel)).toHaveCSS("opacity", "0.5");
	release();
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	await expect(liveBox(panel)).toBeHidden();
	await expect(transcript).toHaveValue(
		new RegExp(`^${first}\\n---\\nMock transcript \\d+$`),
	);
	expect(await transcript.inputValue()).not.toMatch(/Live|more|guess/);
	expect(await readStateTrail(panel)).toContainEqual({
		label: "Processing...",
		live: true,
	});
});

test("TC-11: mode and language controls lock while recording and are remembered when the panel reopens", async ({
	extension,
}) => {
	const session = await extension();
	const { fixture, panel } = session;
	const translate = panel.getByRole("button", { name: "Translate" });
	const modes = ["Translate", "Voice", "Meeting"].map((name) =>
		panel.getByRole("button", { name, exact: true }),
	);
	const spoken = panel.getByLabel("Spoken language");
	const to = panel.getByRole("combobox", { name: /^To\b/ });

	await panel.bringToFront();
	await translate.click();
	await spoken.selectOption("en");
	await to.selectOption("uk");
	await expect(translate).toHaveAttribute("aria-pressed", "true");
	await expect(spoken).toHaveValue("en");
	await expect(to).toHaveValue("uk");

	await fixture.getByLabel("Message").focus();
	await dictate(session, {
		whileRecording: async () => {
			for (const control of [...modes, spoken, to])
				await expect(control).toBeDisabled();
		},
	});
	for (const control of [...modes, spoken, to])
		await expect(control).toBeEnabled();

	// BUG-E15: the reopened panel was back to Voice and Ukrainian.
	await panel.reload();
	await expect(
		panel.getByRole("button", { name: "Translate" }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(spoken).toHaveValue("en");
	await expect(to).toHaveValue("uk");
});

test("TC-12: at docked size (360x640) the controls, live box and notices fit without horizontal scrolling", async ({
	extension,
}) => {
	const session = await extension({
		panelViewport: { height: 640, width: 360 },
	});
	const { context, fixture, panel } = session;
	const scrollWidth = () =>
		panel.evaluate(() => document.documentElement.scrollWidth);
	expect(await scrollWidth()).toBeLessThanOrEqual(360);
	for (const element of [
		recordButton(panel),
		stateLabel(panel),
		panelTranscript(panel),
	])
		await expectInViewport(panel, element);

	await fixture.getByLabel("Message").focus();
	await dictate(session, {
		whileRecording: () => expectInViewport(panel, liveBox(panel)),
	});

	// X1: with a delivery notice the live box's bottom fell below the fold.
	const blank = await context.newPage();
	await blank.goto("about:blank");
	await dictate(session, {
		target: blank,
		whileRecording: async () => {
			await expect(deliveryNotice(panel)).toBeVisible();
			await expectInViewport(panel, deliveryNotice(panel));
			await expectInViewport(panel, liveBox(panel));
			expect(await scrollWidth()).toBeLessThanOrEqual(360);
		},
	});
});
