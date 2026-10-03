import {
	badgeText,
	clickRecord,
	clickToolbarButton,
	dispatchCommand,
	expect,
	panelError,
	realtimeConfigs,
	recordingStarts,
	stateLabel,
	test,
} from "./support/extension-harness";

// Tab capture needs Chrome's real media UI (its fake UI cannot serve a tab) and
// the toolbar click's activeTab grant, so these tests use "granted" and
// clickToolbarButton instead of the fake prompt.

function audioFrames(frames: Array<{ data: unknown; isBinary: boolean }>) {
	return frames.filter((frame) => frame.isBinary).length;
}

test("TC-28: after the toolbar click on the meeting tab, Meeting records the tab and microphone", async ({
	extension,
}) => {
	const session = await extension({ microphone: "granted", page: "meeting" });
	const { fixture, library, mock, panel, worker } = session;
	const chat = fixture.getByLabel("Chat");
	await panel.bringToFront();
	await panel.getByRole("button", { name: "Meeting" }).click();
	await panel.getByLabel("Speakers").check();

	// BUG-E21: the toolbar click opened the panel but never granted tab capture.
	await clickToolbarButton(session, fixture);
	await fixture.bringToFront();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect.poll(() => badgeText(worker)).toBe("●");
	await expect
		.poll(() => audioFrames(mock.realtimeFrames()))
		.toBeGreaterThan(0);
	await fixture.waitForTimeout(2_000);
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });

	await expect(panel.getByText("Shared Audio")).toBeVisible();
	await expect(panel.locator(".meeting-sources")).toContainText(
		/Mock transcript \d+/,
	);
	await expect(chat).toHaveValue("");
	await expect.poll(() => badgeText(worker)).toBe("");
	expect(realtimeConfigs(mock).at(-1)).toMatchObject({
		enable_speaker_diarization: true,
	});
	await expect
		.poll(() => library.recordings().map((r) => r.type))
		.toEqual(["meeting"]);
	expect(library.recordings()[0]?.segments?.[0]).toMatchObject({
		speaker: "1",
	});
	expect(await recordingStarts(worker)).toEqual([
		"mode=meeting, lang=uk, diarization=true",
	]);
});

test("TC-37: after the toolbar grant, three quick presses record one meeting and one press stops it", async ({
	extension,
}) => {
	const session = await extension({ microphone: "granted", page: "meeting" });
	const { fixture, mock, panel, worker } = session;
	const chat = fixture.getByLabel("Chat");
	await clickToolbarButton(session, fixture);
	await fixture.bringToFront();
	await chat.focus();

	for (let press = 0; press < 3; press += 1)
		await dispatchCommand(worker, "toggle-recording");
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect.poll(() => badgeText(worker)).toBe("●");
	await expect
		.poll(() => audioFrames(mock.realtimeFrames()))
		.toBeGreaterThan(0);
	await fixture.waitForTimeout(2_000);
	expect(await recordingStarts(worker)).toEqual([
		expect.stringMatching(/^mode=meeting,/),
	]);

	await dispatchCommand(worker, "toggle-recording");
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	await expect(panel.locator(".meeting-sources")).toContainText(
		/Mock transcript \d+/,
	);
	await expect(chat).toHaveValue("");
	await expect.poll(() => badgeText(worker)).toBe("");
});

test("Meeting: closing the meeting tab mid-recording keeps what was recorded", async ({
	extension,
}) => {
	const session = await extension({ microphone: "granted", page: "meeting" });
	const { fixture, library, mock, panel, worker } = session;
	await panel.bringToFront();
	await panel.getByRole("button", { name: "Meeting" }).click();
	await clickToolbarButton(session, fixture);
	await fixture.bringToFront();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect
		.poll(() => audioFrames(mock.realtimeFrames()))
		.toBeGreaterThan(0);
	await fixture.waitForTimeout(1_000);

	// The captured tab ends the stream, so the recording finishes by itself.
	await fixture.close();
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	await expect(panelError(panel)).toBeHidden();
	await expect
		.poll(() => library.recordings().map((r) => r.status))
		.toEqual(["partiallyRecovered"]);
	await expect.poll(() => badgeText(worker)).toBe("");
});
