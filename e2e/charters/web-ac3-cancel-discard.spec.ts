import type { Page } from "@playwright/test";
import {
	type Workspace,
	dictate,
	dictationDocument,
	dictationStatus,
	disableRealtime,
	expect,
	openWorkspace,
	reloadWorkspace,
	test,
} from "../support/web-workspace";

// Charter AC3 (web): every way to abandon a dictation, at every moment. A
// cancel (Escape, Cancel) never uploads while listening, never writes to the
// library and never changes the document. A reload or a closed tab is an
// interruption instead: the app keeps the audio as one "partially recovered"
// recording (see web-recovery.spec.ts) but still adds no text. Either way the
// next dictation works.

type When = "at once" | "after a second" | "while transcribing";
type How = "Escape" | "Cancel" | "reload" | "close the tab";

const CASES: Array<[How, When]> = [
	["Escape", "at once"],
	["Escape", "after a second"],
	["Escape", "while transcribing"],
	["Cancel", "at once"],
	["Cancel", "after a second"],
	["Cancel", "while transcribing"],
	["reload", "after a second"],
	["reload", "while transcribing"],
	["close the tab", "after a second"],
	["close the tab", "while transcribing"],
];

async function reachMoment(page: Page, when: When) {
	await page.getByRole("button", { name: "Start dictation" }).click();
	if (when === "at once") return;
	await expect(dictationStatus(page)).toHaveText("Listening…");
	await expect(page.locator(".meter-row output")).toHaveText(/^[1-9]s$/);
	if (when === "while transcribing") {
		await page.getByRole("button", { name: "Stop dictation" }).click();
		await expect(dictationStatus(page)).toHaveText(
			"Realtime is unavailable. Transcribing the completed recording…",
		);
	}
}

async function abandon(workspace: Workspace, page: Page, how: How, when: When) {
	const cancelled =
		when === "while transcribing"
			? "Transcription cancelled. Your document is unchanged."
			: "Dictation cancelled.";
	if (how === "Escape") {
		await dictationDocument(page).focus();
		await page.keyboard.press("Escape");
		await expect(dictationStatus(page)).toHaveText(cancelled);
		return page;
	}
	if (how === "Cancel") {
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(dictationStatus(page)).toHaveText(cancelled);
		return page;
	}
	if (how === "reload") {
		await reloadWorkspace(page);
		return page;
	}
	await page.close();
	const next = await workspace.context.newPage();
	await openWorkspace(next, `${workspace.bffUrl}/`);
	return next;
}

for (const [how, when] of CASES)
	test(`AC3 web: ${how} ${when} adds, uploads and saves nothing`, async ({
		workspace,
	}) => {
		const started = await workspace();
		const { library, mock } = started;
		let release: () => void = () => {};
		if (when === "while transcribing") {
			disableRealtime(mock);
			// The upload waits until after the cancel, then would answer.
			await started.page.route("**/bff/api/transcriptions", async (route) => {
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				await route.continue().catch(() => undefined);
			});
		}
		await dictationDocument(started.page).fill("Keep");
		const uploadsBefore = mock.transcriptions().length;

		await reachMoment(started.page, when);
		const page = await abandon(started, started.page, how, when);
		release();
		// Give a late answer time to land somewhere it should not.
		await page.waitForTimeout(1_500);

		const kept = how === "close the tab" ? "" : "Keep";
		const interrupted = how === "reload" || how === "close the tab";
		await expect(dictationDocument(page)).toHaveValue(kept);
		if (interrupted)
			await expect
				.poll(() =>
					library
						.recordings()
						.map((recording) => [recording.status, recording.displayText]),
				)
				.toEqual([
					[
						"partiallyRecovered",
						"Recovered audio from an interrupted recording.",
					],
				]);
		else expect(library.recordings()).toHaveLength(0);
		if (when !== "while transcribing")
			expect(mock.transcriptions()).toHaveLength(uploadsBefore);
		const savedBefore = library.recordings().length;

		mock.clearBehaviors();
		await page.unrouteAll({ behavior: "ignoreErrors" });
		await dictate(page);
		await expect(dictationStatus(page)).toHaveText(
			"Dictation added to this document.",
			{ timeout: 30_000 },
		);
		await expect(dictationDocument(page)).toHaveValue(
			kept ? /^Keep\n---\nMock transcript \d+$/ : /^Mock transcript \d+$/,
		);
		expect(library.recordings()).toHaveLength(savedBefore + 1);
	});
