import {
	clipboardText,
	dictationDocument,
	dictationStatus,
	expect,
	test,
} from "./support/web-workspace";
import { seededRecording } from "./support/workspace-library";

const hour = 3_600_000;

test("TC-40: the command palette lists distinguishable recent transcripts and keyboard, Escape and close return focus", async ({
	workspace,
}) => {
	// The two newest are untitled meetings of the same length from the same minute.
	const sameMinute = Math.floor(Date.now() / 60_000) * 60_000 - hour;
	const recordings = [
		seededRecording({
			createdAt: sameMinute + 40_000,
			durationSeconds: 4,
			id: "c0ffee00-0000-4000-8000-000000000401",
			text: "Newest meeting about the budget",
			type: "meeting",
		}),
		seededRecording({
			createdAt: sameMinute + 20_000,
			durationSeconds: 4,
			id: "c0ffee00-0000-4000-8000-000000000402",
			text: "Meeting about the roadmap",
			type: "meeting",
		}),
		seededRecording({
			createdAt: sameMinute - 3 * hour,
			durationSeconds: 12,
			id: "c0ffee00-0000-4000-8000-000000000403",
			text: "Oldest dictation about lunch",
		}),
	];
	const { page } = await workspace({ recordings });
	const document = dictationDocument(page);
	const palette = page.getByRole("dialog", { name: "Command palette" });
	const search = palette.getByLabel("Search recent transcripts");
	const rows = palette
		.getByRole("list", { name: "Recent transcripts" })
		.getByRole("button");

	await document.fill("Draft");
	await document.focus();
	await page.keyboard.press("Alt+Shift+P");
	await expect(palette).toBeVisible();
	await expect(search).toBeFocused();
	await expect(rows).toHaveCount(3);
	// BUG-W15: every untitled row read just "Untitled recording".
	const labels = await rows.allTextContents();
	expect(new Set(labels).size).toBe(labels.length);
	await expect(document).toHaveValue("Draft");

	await search.fill("zzzz-no-match");
	await expect(
		palette.getByText("No recent transcripts match your search."),
	).toBeVisible();
	await search.fill("");
	await expect(rows).toHaveCount(3);
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowUp");
	await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
	await page.keyboard.press("Enter");
	await expect(palette).toBeHidden();
	await expect
		.poll(() => clipboardText(page))
		.toBe("Meeting about the roadmap");
	await expect(dictationStatus(page)).toHaveText("Transcript copied.");
	await expect(document).toBeFocused();

	await page.keyboard.press("Alt+Shift+P");
	await expect(palette).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(palette).toBeHidden();
	await expect(document).toBeFocused();

	const start = page.getByRole("button", { name: "Start dictation" });
	await start.focus();
	await page.keyboard.press("Alt+Shift+P");
	await expect(palette).toBeVisible();
	await palette.getByRole("button", { name: "Close command palette" }).click();
	await expect(palette).toBeHidden();
	await expect(start).toBeFocused();

	await page.keyboard.press("Alt+Shift+P");
	await expect(palette).toBeVisible();
	await page.keyboard.press("Alt+Shift+V");
	await expect(palette).toBeVisible();
	await expect(dictationStatus(page)).not.toHaveText("Listening…");
	await page.keyboard.press("Escape");
	await expect(palette).toBeHidden();
});

test("TC-41: a dictation shortcut that collides with the command palette is refused", async ({
	workspace,
}) => {
	const { library, page } = await workspace({
		settings: { dictationShortcut: "Alt+V" },
	});
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await page.getByLabel("Key", { exact: true }).press("Alt+Shift+P");
	await page.getByRole("button", { name: "Save shortcut" }).click();
	// BUG-W14: it was saved, but the key only ever opened the command palette.
	await expect(
		page.getByText("Alt+Shift+P opens the command palette and cannot be used."),
	).toBeVisible();
	expect(library.settings().dictationShortcut).toBe("Alt+V");

	await page.getByRole("button", { name: "Dictation", exact: true }).click();
	await expect(page.locator(".meter-row .shortcut")).toHaveText(
		"Shortcut: Alt + V",
	);
	await page.getByRole("button", { name: "Dictation", exact: true }).focus();
	await page.keyboard.press("Alt+Shift+P");
	await expect(
		page.getByRole("dialog", { name: "Command palette" }),
	).toBeVisible();
	await expect(dictationStatus(page)).not.toHaveText("Listening…");
});
