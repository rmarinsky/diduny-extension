import {
	clickRecord,
	dictate,
	dispatchCommand,
	expect,
	liveBox,
	panelError,
	panelTranscript,
	readStateTrail,
	realtimeConfigs,
	recordingStarts,
	stateLabel,
	storageGet,
	test,
	watchStateTrail,
} from "./support/extension-harness";

const TAB_CAPTURE_NOT_INVOKED =
	"Chrome lets Diduny record a tab only after you click the Diduny toolbar button on it. Click it on the meeting tab, then start the meeting recording.";

test("TC-26: Translate mode offers a To language, records, inserts the result and refuses the same source and target", async ({
	extension,
}) => {
	const session = await extension({ streamLiveTokens: true });
	const { fixture, mock, panel } = session;
	const message = fixture.getByLabel("Message");
	const spoken = panel.getByLabel("Spoken language");
	// The wrapping label names it "To English" or "To Ukrainian".
	const to = panel.getByRole("combobox", { name: /^To\b/ });
	await message.focus();

	await panel.bringToFront();
	await panel.getByRole("button", { name: "Translate" }).click();
	await expect(to).toBeVisible();
	await expect(to.locator("option")).toHaveText(["English", "Ukrainian"]);
	await expect(spoken).toHaveValue("uk");
	await expect(to).toHaveValue("en");

	await dictate(session, {
		whileRecording: () => expect(liveBox(panel)).toContainText("Mock"),
	});
	await expect(message).toHaveValue(/^Mock transcript \d+$/);
	await expect(panelTranscript(panel)).toHaveValue(/^Mock transcript \d+$/);
	const upload = mock.transcriptions().at(-1)?.body ?? "";
	expect(upload).toContain('"mode":"translate"');
	expect(upload).toContain('"target_language":"en"');

	// BUG-E16: Ukrainian to Ukrainian was accepted and recorded.
	await panel.bringToFront();
	await to.selectOption("uk");
	await expect(to).toHaveValue("uk");
	await expect(spoken).toHaveValue("en");
	await message.fill("");
	await message.focus();
	await dictate(session);
	expect(realtimeConfigs(mock).at(-1)).toMatchObject({
		language_hints: ["en"],
		mode: "translate",
		translation: { target_language: "uk", type: "one_way" },
	});

	// A start that still names the same pair (a stale shortcut or message) is refused.
	const configs = realtimeConfigs(mock).length;
	await panel.evaluate(() =>
		chrome.runtime.sendMessage({
			diarization: false,
			language: "uk",
			mode: "translation",
			translation: { targetLanguage: "uk" },
			type: "start-recording",
		}),
	);
	await expect(panelError(panel)).toHaveText(
		"Choose two different languages to translate between.",
	);
	expect(realtimeConfigs(mock)).toHaveLength(configs);
});

test("TC-27: translation dictation has a shortcut after install, Settings lists the shortcuts, and the command records", async ({
	extension,
}) => {
	const session = await extension();
	const { context, fixture, mock, openExtensionPage, panel, worker } = session;
	const shortcuts = await panel.evaluate(() => chrome.commands.getAll());
	// BUG-E11: Chrome reserves Alt+Shift+T, so toggle-translation had no key at all.
	expect(
		Object.fromEntries(
			shortcuts.map((command) => [command.name, command.shortcut]),
		),
	).toMatchObject({
		"start-meeting": "Alt+Shift+M",
		"toggle-recording": "Alt+Shift+V",
		"toggle-translation": "Alt+V",
	});

	const options = await openExtensionPage("options.html");
	const list = options.getByRole("list", { name: "Keyboard shortcuts" });
	await expect(
		list.getByRole("listitem").filter({ hasText: "translation dictation" }),
	).toContainText("Alt+V");
	await expect(list.getByRole("listitem")).toHaveCount(3);
	const shortcutsPage = context.waitForEvent("page");
	await options.getByRole("button", { name: "Change shortcuts" }).click();
	expect((await shortcutsPage).url()).toBe("chrome://extensions/shortcuts");

	// Playwright cannot press a browser shortcut; Chrome's command event is dispatched instead.
	const message = fixture.getByLabel("Message");
	await fixture.bringToFront();
	await message.focus();
	await dispatchCommand(worker, "toggle-translation");
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect
		.poll(() => mock.realtimeFrames().some((frame) => frame.isBinary))
		.toBe(true);
	await dispatchCommand(worker, "toggle-translation");
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	await expect(message).toHaveValue(/^Mock transcript \d+$/);
	expect(realtimeConfigs(mock).at(-1)).toMatchObject({
		mode: "translate",
		translation: { target_language: "en" },
	});
});

test("TC-28: Meeting mode shows its controls and explains what to do when Chrome refuses tab capture", async ({
	extension,
}) => {
	const { fixture, panel } = await extension({ page: "meeting" });
	const chat = fixture.getByLabel("Chat");
	await panel.bringToFront();
	await panel.getByRole("button", { name: "Meeting" }).click();
	await expect(panel.getByLabel("Speakers")).toBeVisible();
	await expect(
		panel.getByText(
			"Records the current browser tab and your microphone. Native meeting apps and system audio are not available.",
		),
	).toBeVisible();

	// The panel opened as a tab never got activeTab, so Chrome refuses the capture.
	// BUG-E10: the panel showed Chrome's "Extension has not been invoked…" wording.
	await fixture.bringToFront();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Error");
	await expect(panelError(panel)).toHaveText(TAB_CAPTURE_NOT_INVOKED);
	await expect(chat).toHaveValue("");
});

test("TC-29: keyboard shortcuts record in the language chosen in the side panel", async ({
	extension,
}) => {
	const session = await extension({ page: "meeting" });
	const { fixture, mock, panel, worker } = session;
	await panel.bringToFront();
	await panel.getByLabel("Spoken language").selectOption("en");
	await expect
		.poll(() => storageGet(worker, "didunyRecordingPreferences"))
		.toMatchObject({ language: "en" });

	// BUG-E20: every shortcut recorded in Ukrainian.
	await fixture.bringToFront();
	await fixture.getByLabel("Chat").focus();
	await dispatchCommand(worker, "toggle-recording");
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect
		.poll(() => mock.realtimeFrames().some((frame) => frame.isBinary))
		.toBe(true);
	await dispatchCommand(worker, "toggle-recording");
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	expect(realtimeConfigs(mock).at(-1)).toMatchObject({
		language_hints: ["en"],
		mode: "transcribe",
	});

	await dispatchCommand(worker, "start-meeting");
	await expect
		.poll(async () => (await recordingStarts(worker)).at(-1))
		.toMatch(/^mode=meeting, lang=en,/);
	expect(await recordingStarts(worker)).not.toContainEqual(
		expect.stringContaining("lang=uk"),
	);
});

test("TC-37: pressing the dictation shortcut three times quickly starts only a meeting recording", async ({
	extension,
}) => {
	const { fixture, panel, worker } = await extension({ page: "meeting" });
	const chat = fixture.getByLabel("Chat");
	await chat.focus();
	await watchStateTrail(panel);
	const startsBefore = (await recordingStarts(worker)).length;

	for (let press = 0; press < 3; press += 1)
		await dispatchCommand(worker, "toggle-recording");
	// Without a toolbar click Chrome refuses tab capture, so the meeting ends in Error.
	await expect(panelError(panel)).toHaveText(TAB_CAPTURE_NOT_INVOKED);
	await fixture.waitForTimeout(1_000);

	const starts = (await recordingStarts(worker)).slice(startsBefore);
	expect(starts).toHaveLength(1);
	expect(starts[0]).toMatch(/^mode=meeting,/);
	const states = (await readStateTrail(panel)).map((entry) => entry.label);
	expect(states).not.toContain("Recording...");
	expect(states.filter((label) => label === "Starting...")).toHaveLength(1);
	await expect(chat).toHaveValue("");
});
