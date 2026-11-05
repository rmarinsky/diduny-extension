import {
	badgeText,
	clickRecord,
	dictate,
	expect,
	panelError,
	panelTranscript,
	recordButton,
	stateLabel,
	test,
} from "./support/extension-harness";

test("TC-34: upstream 401, 402 and 500 during side-panel dictation show an explanatory error and keep the Transcript", async ({
	extension,
}) => {
	const session = await extension();
	const { fixture, mock, panel } = session;
	const message = fixture.getByLabel("Message");
	const transcript = panelTranscript(panel);
	await panel.bringToFront();
	await transcript.fill("KEEP");
	await message.focus();

	// X2: the panel showed "Transcription failed (401)".
	for (const [behavior, explanation] of [
		[
			"unauthorized",
			"Your Diduny sign-in has expired. Sign in again, then retry.",
		],
		[
			"quota",
			"You are out of hours (2 of 2 used). Add hours or wait for your plan to renew, then try again.",
		],
		[
			"server_error",
			"The Diduny service rejected this request. Try again; if it continues, restart the local Diduny service.",
		],
	] as const) {
		mock.setBehavior("/api/v1/realtime", behavior);
		mock.setBehavior("/api/v1/transcriptions", behavior);
		await dictate(session, { end: "Error", waitForAudio: false });
		await expect(panelError(panel), behavior).toHaveText(explanation);
		await expect(transcript).toHaveValue("KEEP");
		await expect(message).toHaveValue("");
	}

	mock.clearBehaviors();
	await dictate(session);
	await expect(message).toHaveValue(/^Mock transcript \d+$/);
	await expect(transcript).toHaveValue(/^KEEP\n---\nMock transcript \d+$/);
});

test("TC-35: a transcription that never answers ends with a timeout error and Record works again", async ({
	extension,
}) => {
	test.setTimeout(120_000);
	const session = await extension();
	const { fixture, mock, panel, worker } = session;
	const message = fixture.getByLabel("Message");
	mock.setBehavior("/api/v1/realtime", "hang");
	mock.setBehavior("/api/v1/transcriptions", "hang");
	await message.focus();

	await dictate(session, { end: "Processing...", waitForAudio: false });
	// X3: without a time limit the panel stayed on Processing for good.
	await expect(stateLabel(panel)).toHaveText("Error", { timeout: 60_000 });
	await expect(panelError(panel)).toHaveText(
		"Transcription took too long and was stopped. Nothing was inserted; record again to retry.",
	);
	await expect(recordButton(panel)).toBeEnabled();
	await expect.poll(() => badgeText(worker)).toBe("");
	await expect(message).toHaveValue("");

	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Recording...");
});
