import type { Page } from "@playwright/test";
import {
	dictate,
	dictationDocument,
	dictationStatus,
	disableRealtime,
	expect,
	holdTranscriptions,
	test,
} from "./support/web-workspace";

const realtimeFallback =
	"Realtime is unavailable. Transcribing the completed recording…";

async function expectWorkspaceIdle(page: Page) {
	for (const name of ["Library", "Settings", "About delivery", "Sign out"])
		await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
	await expect(
		page.getByRole("button", { name: "Start dictation" }),
	).toBeEnabled();
}

test("TC-05: an exhausted quota (402) shows the hours message and leaves the document unchanged", async ({
	workspace,
}) => {
	const { library, mock, page } = await workspace();
	mock.setBehavior("/api/v1/realtime", "quota");
	mock.setBehavior("/api/v1/transcriptions", "quota");
	await dictationDocument(page).fill("Keep me");

	await dictate(page);
	await expect(dictationStatus(page)).toHaveText(
		/^You are out of hours .*Add hours or wait for your plan to renew, then try again\.$/,
	);
	await expect(dictationDocument(page)).toHaveValue("Keep me");
	expect(library.recordings()).toEqual([]);
});

test("TC-06: an upstream failure (500) shows the rejected-request message, then dictation works again", async ({
	workspace,
}) => {
	const { mock, page } = await workspace();
	mock.setBehavior("/api/v1/realtime", "server_error");
	mock.setBehavior("/api/v1/transcriptions", "server_error");
	await dictationDocument(page).fill("Keep me");

	await dictate(page);
	await expect(dictationStatus(page)).toHaveText(
		"The Diduny service rejected this request. Try again; if it continues, restart the local Diduny service.",
	);
	await expect(dictationDocument(page)).toHaveValue("Keep me");
	await expect(
		page.getByRole("button", { name: "Start dictation" }),
	).toBeEnabled();

	mock.clearBehaviors();
	await dictate(page);
	await expect(dictationDocument(page)).toHaveValue(
		/^Keep me\n---\nMock transcript \d+$/,
	);
	await expect(dictationStatus(page)).toHaveText(
		"Dictation added to this document.",
	);
});

test("TC-12: an empty transcription shows 'The transcription returned no text.' and leaves the document unchanged", async ({
	workspace,
}) => {
	const { mock, override, page } = await workspace();
	disableRealtime(mock);
	override("POST /api/v1/transcriptions", { body: { text: "", tokens: [] } });
	await dictationDocument(page).fill("Keep me");

	await dictate(page);
	await expect(dictationStatus(page)).toHaveText(
		"The transcription returned no text.",
	);
	await expect(dictationStatus(page)).toBeFocused();
	await expect(dictationDocument(page)).toHaveValue("Keep me");
});

test("TC-13: an expired sign-in (401) during transcription asks to sign in again and keeps the document", async ({
	workspace,
}) => {
	const { mock, page } = await workspace();
	mock.setBehavior("/api/v1/realtime", "unauthorized");
	mock.setBehavior("/api/v1/transcriptions", "unauthorized");
	await dictationDocument(page).fill("Keep me");

	await dictate(page);
	await expect(dictationStatus(page)).toHaveText(
		"Your Diduny sign-in has expired. Sign in again, then retry.",
	);
	await expect(dictationDocument(page)).toHaveValue("Keep me");
});

test("TC-14: without realtime the completed recording is transcribed and still appended", async ({
	workspace,
}) => {
	const { mock, page } = await workspace();
	disableRealtime(mock);
	const release = await holdTranscriptions(page);

	await dictate(page);
	await expect(dictationStatus(page)).toHaveText(realtimeFallback);
	release();
	await expect(dictationDocument(page)).toHaveValue("Mock transcript 1");
	await expect(dictationStatus(page)).toHaveText(
		"Dictation added to this document.",
	);
	expect(mock.transcriptions()).toHaveLength(1);
});

test("TC-29: a transcription that never answers can be cancelled and times out, and the user can dictate again", async ({
	workspace,
}) => {
	test.setTimeout(120_000);
	const { mock, page } = await workspace();
	disableRealtime(mock);
	mock.setBehavior("/api/v1/transcriptions", "hang");
	const document = dictationDocument(page);
	await document.fill("KEEP ME");

	// BUG-W19: Escape and Cancel did nothing while the request hung.
	await dictate(page);
	await expect(dictationStatus(page)).toHaveText(realtimeFallback);
	await page.keyboard.press("Escape");
	await expect(dictationStatus(page)).toHaveText(
		"Transcription cancelled. Your document is unchanged.",
	);
	await expect(document).toHaveValue("KEEP ME");
	await expectWorkspaceIdle(page);

	await dictate(page);
	await expect(dictationStatus(page)).toHaveText(realtimeFallback);
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(dictationStatus(page)).toHaveText(
		"Transcription cancelled. Your document is unchanged.",
	);

	// BUG-W19: the page stayed on "Transcribing…" forever.
	await dictate(page);
	await expect(dictationStatus(page)).toHaveText(realtimeFallback);
	await expect(dictationStatus(page)).toHaveText(
		"Transcription took too long and was stopped. Your document is unchanged; dictate again to retry.",
		{ timeout: 30_000 },
	);
	await expect(document).toHaveValue("KEEP ME");
	await expectWorkspaceIdle(page);

	await page.getByRole("button", { name: "Start dictation" }).click();
	await expect(dictationStatus(page)).toHaveText("Listening…");
});
