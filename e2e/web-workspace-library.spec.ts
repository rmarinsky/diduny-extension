import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
	dictate,
	dictationDocument,
	dictationStatus,
	expect,
	readZip,
	test,
} from "./support/web-workspace";
import { seededRecording } from "./support/workspace-library";

function libraryRows(page: Page) {
	return page
		.getByRole("list", { name: "Library recordings" })
		.getByRole("button");
}

const meetingId = (index: number) =>
	`c0ffee00-0000-4000-8000-0000000003${String(index).padStart(2, "0")}`;

test("TC-24: 'Never save' keeps dictations out of the library and '7 days' saves them", async ({
	workspace,
}) => {
	const { library, page } = await workspace({
		retention: { dictation: "never" },
	});
	await dictate(page);
	await expect(dictationStatus(page)).toHaveText(
		"Dictation added to this document.",
	);

	await page.getByRole("button", { name: "Library", exact: true }).click();
	await page
		.getByRole("combobox", { name: "Recording type" })
		.selectOption("voice");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(
		page.getByText("No recordings match your search."),
	).toBeVisible();
	expect(library.recordings()).toEqual([]);

	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await page.getByLabel("Dictation and translation").selectOption("days7");
	await expect(page.getByText("Retention policy saved.")).toBeVisible();

	await page.getByRole("button", { name: "Dictation", exact: true }).click();
	await dictate(page);
	await expect(dictationDocument(page)).toHaveValue(
		"Mock transcript 1\n---\nMock transcript 2",
	);
	await expect.poll(() => library.recordings().length).toBe(1);
	await page.getByRole("button", { name: "Library", exact: true }).click();
	await expect(libraryRows(page).first()).toContainText("Untitled recording");
	await expect(libraryRows(page).first()).toContainText(
		"Dictation · Transcribed",
	);
});

test("TC-27: Escape cancels the inline delete confirmation and focus returns to 'Delete recording'", async ({
	workspace,
}) => {
	const { library, page } = await workspace({
		recordings: [
			seededRecording({ id: meetingId(1), text: "Keep this recording" }),
		],
	});
	await page.getByRole("button", { name: "Library", exact: true }).click();
	await libraryRows(page).first().click();
	const deleteRecording = page.getByRole("button", {
		exact: true,
		name: "Delete recording",
	});

	await deleteRecording.click();
	await expect(
		page.getByRole("button", { name: "Delete permanently" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Cancel delete" }),
	).toBeVisible();

	// BUG-W7: Escape left the confirmation open; Cancel dropped focus to the body.
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Delete permanently" }),
	).toHaveCount(0);
	await expect(deleteRecording).toBeFocused();

	await deleteRecording.click();
	await page.getByRole("button", { name: "Cancel delete" }).click();
	await expect(
		page.getByRole("button", { name: "Delete permanently" }),
	).toHaveCount(0);
	await expect(deleteRecording).toBeFocused();
	expect(library.recordings()).toHaveLength(1);
});

test("TC-38: the library export contains every recording", async ({
	workspace,
}) => {
	const { library, page } = await workspace({
		recordings: [
			seededRecording({
				createdAt: Date.now() - 3_600_000,
				id: meetingId(1),
				text: "Meeting notes for the export",
				title: "Weekly sync",
				type: "meeting",
			}),
		],
		retention: { dictation: "days7" },
	});
	await dictate(page);
	await expect(dictationDocument(page)).toHaveValue("Mock transcript 1");
	await expect.poll(() => library.recordings().length).toBe(2);

	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const downloaded = page.waitForEvent("download");
	await page.getByRole("link", { name: "Download library export" }).click();
	const download = await downloaded;
	expect(download.suggestedFilename()).toBe("diduny-library.zip");
	await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

	const zip = readZip(await readFile(await download.path()));
	expect(zip.get("README.txt")?.toString()).toContain("Diduny Library Export");
	for (const recording of library.recordings()) {
		const base = `recordings/${recording.id}`;
		expect(zip.get(`${base}/transcript.txt`)?.toString()).toBe(recording.text);
		expect(
			JSON.parse(zip.get(`${base}/metadata.json`)?.toString() ?? "{}"),
		).toMatchObject({ id: recording.id, type: recording.type });
		expect(
			zip.get(`${base}/transcript-history/01-current.txt`)?.toString(),
		).toBe(recording.text);
		expect(zip.get(`${base}/audio/${recording.media.fileName}`)?.length).toBe(
			recording.media.fileSizeBytes,
		);
	}
});

test("TC-39: status and type filters apply on Search, and dictation playback shows its length", async ({
	workspace,
}) => {
	const { library, page } = await workspace({
		capture: "real",
		recordings: [
			seededRecording({
				createdAt: Date.now() - 3_600_000,
				id: meetingId(1),
				text: "First meeting",
				type: "meeting",
			}),
			seededRecording({
				createdAt: Date.now() - 7_200_000,
				id: meetingId(2),
				text: "Second meeting",
				type: "meeting",
			}),
			seededRecording({
				createdAt: Date.now() - 10_800_000,
				id: meetingId(3),
				status: "partiallyRecovered",
				text: "Recovered meeting",
				type: "meeting",
			}),
		],
		retention: { dictation: "days7" },
	});
	await page.getByRole("button", { name: "Start dictation" }).click();
	await expect(page.locator(".meter-row output")).toHaveText("2s");
	await page.getByRole("button", { name: "Stop dictation" }).click();
	await expect(dictationDocument(page)).toHaveValue("Mock transcript 1");
	await expect.poll(() => library.recordings().length).toBe(4);

	await page.getByRole("button", { name: "Library", exact: true }).click();
	await expect(libraryRows(page)).toHaveCount(4);
	await page.getByRole("combobox", { name: "Status" }).selectOption("failed");
	await expect(libraryRows(page)).toHaveCount(4);
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(
		page.getByText("No recordings match your search."),
	).toBeVisible();

	await page
		.getByRole("combobox", { name: "Status" })
		.selectOption("transcribed");
	await page
		.getByRole("combobox", { name: "Recording type" })
		.selectOption("meeting");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(libraryRows(page)).toHaveCount(2);
	for (const row of await libraryRows(page).all())
		await expect(row).toContainText("Meeting · Transcribed");

	await page.getByRole("combobox", { name: "Status" }).selectOption("");
	await page.getByRole("combobox", { name: "Recording type" }).selectOption("");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(libraryRows(page)).toHaveCount(4);
	await libraryRows(page)
		.filter({ hasText: "Dictation · Transcribed" })
		.click();

	const player = page.getByLabel("Recording playback");
	// BUG-W10: the dictation's WebM had no duration until it was played to the end.
	await expect
		.poll(() =>
			player.evaluate((audio: HTMLAudioElement) =>
				Number.isFinite(audio.duration) ? audio.duration : -1,
			),
		)
		.toBeGreaterThan(1);
	expect(
		await player.evaluate((audio: HTMLAudioElement) => audio.duration),
	).toBeLessThan(4);
	const history = page.getByRole("region", { name: "Transcript history" });
	await expect(history).toContainText("Current version");
	await expect(history).toContainText("cloud");
	await expect(history).toContainText("Mock transcript 1");

	await player.evaluate((audio: HTMLAudioElement) => audio.play());
	await expect
		.poll(() => player.evaluate((audio: HTMLAudioElement) => audio.currentTime))
		.toBeGreaterThan(0.5);
	await expect
		.poll(() =>
			player.evaluate(
				(audio: HTMLAudioElement) => audio.textTracks[0]?.cues?.length ?? 0,
			),
		)
		.toBeGreaterThan(0);
});
