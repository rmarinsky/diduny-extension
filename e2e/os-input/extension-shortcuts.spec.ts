import {
	badgeText,
	expect,
	realtimeConfigs,
	recordingStarts,
	stateLabel,
	storageGet,
	test,
} from "../support/extension-harness";
import { osInputAvailable, pressKeys } from "../support/os-input";

// Real key presses into a visible Chromium window: Chrome's own shortcut
// handling runs, and a command grants activeTab as it does for a user.
test.skip(!osInputAvailable, "Real OS input needs Windows");

function audioFrames(frames: Array<{ isBinary: boolean }>) {
	return frames.filter((frame) => frame.isBinary).length;
}

test("TC-27 (real keys): Alt+V starts and stops translation dictation and inserts the result", async ({
	extension,
}) => {
	const { fixture, mock, panel, worker } = await extension({ headed: true });
	const message = fixture.getByLabel("Message");
	await message.focus();

	await pressKeys(fixture, "Alt+V");
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect
		.poll(() => audioFrames(mock.realtimeFrames()))
		.toBeGreaterThan(0);
	await pressKeys(fixture, "Alt+V");
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	await expect(message).toHaveValue(/^Mock transcript \d+$/);
	expect(realtimeConfigs(mock).at(-1)).toMatchObject({
		mode: "translate",
		translation: { target_language: "en" },
	});
	expect(await recordingStarts(worker)).toEqual([
		expect.stringMatching(/^mode=translation,/),
	]);
});

test("TC-29 (real keys): shortcuts record in the panel's language, and Alt+Shift+M records a meeting through its own grant", async ({
	extension,
}) => {
	const { fixture, mock, panel, worker } = await extension({
		headed: true,
		microphone: "granted",
		page: "meeting",
	});
	const chat = fixture.getByLabel("Chat");
	await panel.bringToFront();
	await panel.getByLabel("Spoken language").selectOption("en");
	await expect
		.poll(() => storageGet(worker, "didunyRecordingPreferences"))
		.toMatchObject({ language: "en" });

	await chat.focus();
	await pressKeys(fixture, "Alt+Shift+V");
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect
		.poll(() => audioFrames(mock.realtimeFrames()))
		.toBeGreaterThan(0);
	await pressKeys(fixture, "Alt+Shift+V");
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	expect(realtimeConfigs(mock).at(-1)).toMatchObject({
		language_hints: ["en"],
		mode: "transcribe",
	});
	await expect(chat).toHaveValue(/^Mock transcript \d+$/);
	const chatAfterDictation = await chat.inputValue();

	// The command itself grants tab capture; no toolbar click is needed.
	const framesBefore = audioFrames(mock.realtimeFrames());
	await pressKeys(fixture, "Alt+Shift+M");
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect.poll(() => badgeText(worker)).toBe("●");
	await expect
		.poll(() => audioFrames(mock.realtimeFrames()))
		.toBeGreaterThan(framesBefore);
	await fixture.waitForTimeout(2_000);
	await pressKeys(fixture, "Alt+Shift+M");
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	await expect(panel.locator(".meeting-sources")).toContainText(
		/Mock transcript \d+/,
	);
	expect((await recordingStarts(worker)).at(-1)).toMatch(
		/^mode=meeting, lang=en,/,
	);
	await expect(chat).toHaveValue(chatAfterDictation);
});

test("TC-37 (real keys): three quick Alt+Shift+V presses start only a meeting, and one press stops it", async ({
	extension,
}) => {
	const { fixture, mock, panel, worker } = await extension({
		headed: true,
		microphone: "granted",
		page: "meeting",
	});
	const chat = fixture.getByLabel("Chat");
	await chat.focus();

	await pressKeys(fixture, "Alt+Shift+V", { gapMs: 80, times: 3 });
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect.poll(() => badgeText(worker)).toBe("●");
	await expect
		.poll(() => audioFrames(mock.realtimeFrames()))
		.toBeGreaterThan(0);
	await fixture.waitForTimeout(2_000);
	expect(await recordingStarts(worker)).toEqual([
		expect.stringMatching(/^mode=meeting,/),
	]);
	await expect(chat).toHaveValue("");

	await pressKeys(fixture, "Alt+Shift+V");
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	await expect(panel.locator(".meeting-sources")).toContainText(
		/Mock transcript \d+/,
	);
	await expect(chat).toHaveValue("");
	await expect.poll(() => badgeText(worker)).toBe("");
});

test("Real keys: on the Diduny web app's tab, Alt+Shift+V starts the web app's own dictation", async ({
	extension,
}) => {
	const { panel, web, worker } = await extension({ headed: true });
	const status = web.locator(".meter-row .status");
	const document = web.getByLabel("Dictation document");
	await document.focus();

	await pressKeys(web, "Alt+Shift+V");
	await expect(status).toHaveText("Listening…");
	await web.waitForTimeout(1_500);
	await pressKeys(web, "Alt+Shift+V");
	await expect(document).toHaveValue(/Mock transcript \d+$/, {
		timeout: 30_000,
	});
	// The extension handed the key to the page instead of recording itself.
	expect(await recordingStarts(worker)).toEqual([]);
	await expect(stateLabel(panel)).toHaveText("Ready");
});
