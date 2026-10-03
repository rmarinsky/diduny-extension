import type { Page } from "@playwright/test";
import { DICTATION_SEPARATOR } from "../../web/src/dictation";
import {
	type CharterAction,
	SPEEDRUNNER,
	charterSeeds,
	walk,
} from "../support/charter";
import {
	type Workspace,
	dictationDocument,
	dictationStatus,
	expect,
	reloadWorkspace,
	test,
} from "../support/web-workspace";

// Charter AC1 (web): every way to start and stop dictation, in any order and
// at Speedrunner pace. Invariants: only known states, each finished dictation
// is appended exactly once, a cancel or a tap adds and saves nothing, and the
// page always comes back to rest.

const BUSY = new Set([
	"Listening…",
	"Transcribing…",
	"Realtime is unavailable. Transcribing the completed recording…",
]);
const ADDED = "Dictation added to this document.";
const NOTHING_ADDED = new Set([
	"No speech detected. Nothing was sent.",
	"Dictation cancelled.",
	"Transcription cancelled. Your document is unchanged.",
]);
const RESTING = new Set([...NOTHING_ADDED, ADDED, "Ready to dictate."]);

interface Model {
	doc: string;
	lastNumber: number;
	listening: boolean;
	page: Page;
	saved: number;
	workspace: Workspace;
}

async function settle(model: Model) {
	const status = dictationStatus(model.page);
	await expect
		.poll(async () => BUSY.has((await status.textContent()) ?? ""), {
			timeout: 30_000,
		})
		.toBe(false);
	return (await status.textContent()) ?? "";
}

/** After a stop: either exactly one new "Mock transcript N" at the end, or nothing at all. */
async function expectOutcome(model: Model) {
	model.listening = false;
	const status = await settle(model);
	const document = dictationDocument(model.page);
	if (status === ADDED) {
		const prefix = model.doc.trimEnd()
			? `${model.doc.trimEnd()}${DICTATION_SEPARATOR}`
			: "";
		const value = await document.inputValue();
		expect(value.startsWith(prefix), "the old text stays first").toBe(true);
		const added = value.slice(prefix.length).match(/^Mock transcript (\d+)$/);
		expect(
			added,
			`one transcript appended, got ${JSON.stringify(value)}`,
		).not.toBeNull();
		const number = Number(added?.[1]);
		expect(number).toBeGreaterThan(model.lastNumber);
		model.lastNumber = number;
		model.doc = value;
		model.saved += 1;
		return;
	}
	expect(NOTHING_ADDED, `unexpected outcome "${status}"`).toContain(status);
	await expect(document).toHaveValue(model.doc);
}

async function recordFor(page: Page, seconds: number) {
	await expect(page.locator(".meter-row output")).toHaveText(
		new RegExp(`^([${seconds}-9]|\\d{2,})s$`),
	);
}

const toggleShortcut = async (page: Page, inDocument: boolean) => {
	if (inDocument) await dictationDocument(page).focus();
	else
		await dictationDocument(page).evaluate((field) =>
			(field as HTMLTextAreaElement).blur(),
		);
	await page.keyboard.press("Alt+Shift+V");
};

const forwardedEvent = (page: Page) =>
	page.evaluate(() =>
		window.dispatchEvent(new Event("diduny:dictation-shortcut")),
	);

const idle = (model: Model) => !model.listening;
const listening = (model: Model) => model.listening;

function started(model: Model) {
	return async () => {
		await expect(dictationStatus(model.page)).toHaveText("Listening…");
		model.listening = true;
	};
}

const actions: CharterAction<Model>[] = [
	{
		enabled: idle,
		name: "Start with the button",
		async run(model) {
			await model.page.getByRole("button", { name: "Start dictation" }).click();
			await started(model)();
		},
	},
	{
		enabled: idle,
		name: "Start with Enter on the focused button",
		async run(model) {
			await model.page.getByRole("button", { name: "Start dictation" }).focus();
			await model.page.keyboard.press("Enter");
			await started(model)();
		},
	},
	{
		enabled: idle,
		name: "Start with Alt+Shift+V outside the document",
		async run(model) {
			await toggleShortcut(model.page, false);
			await started(model)();
		},
	},
	{
		enabled: idle,
		name: "Start with Alt+Shift+V in the document",
		async run(model) {
			await toggleShortcut(model.page, true);
			await started(model)();
		},
	},
	{
		enabled: idle,
		name: "Start with the extension's forwarded shortcut",
		async run(model) {
			await forwardedEvent(model.page);
			await started(model)();
		},
	},
	{
		enabled: idle,
		name: "Hold to record for a second",
		async run(model) {
			await model.page.getByRole("button", { name: "Hold to record" }).hover();
			await model.page.mouse.down();
			await model.page.waitForTimeout(1_200);
			await model.page.mouse.up();
			await expectOutcome(model);
		},
	},
	{
		enabled: idle,
		name: "Tap hold to record",
		async run(model) {
			await model.page.getByRole("button", { name: "Hold to record" }).hover();
			await model.page.mouse.down();
			await model.page.waitForTimeout(40);
			await model.page.mouse.up();
			await expectOutcome(model);
		},
	},
	{
		name: "Type at the end of the document",
		async run(model, random) {
			const word = ` typed${Math.floor(random() * 1_000)}`;
			const document = dictationDocument(model.page);
			await document.focus();
			await model.page.keyboard.press("Control+End");
			await model.page.keyboard.type(word);
			model.doc += word;
		},
	},
	{
		enabled: idle,
		name: "Reload the page",
		async run(model) {
			await reloadWorkspace(model.page);
		},
	},
	{
		enabled: idle,
		name: "Open the Library and come back",
		async run(model) {
			await model.page
				.getByRole("button", { name: "Library", exact: true })
				.click();
			await model.page
				.getByRole("button", { name: "Dictation", exact: true })
				.click();
		},
	},
	{
		enabled: listening,
		name: "Stop with the button after a second",
		weight: 2,
		async run(model) {
			await recordFor(model.page, 1);
			await model.page.getByRole("button", { name: "Stop dictation" }).click();
			await expectOutcome(model);
		},
	},
	{
		enabled: listening,
		name: "Stop with Alt+Shift+V after a second",
		async run(model) {
			await recordFor(model.page, 1);
			await toggleShortcut(model.page, false);
			await expectOutcome(model);
		},
	},
	{
		enabled: listening,
		name: "Stop with the forwarded shortcut after a second",
		async run(model) {
			await recordFor(model.page, 1);
			await forwardedEvent(model.page);
			await expectOutcome(model);
		},
	},
	{
		enabled: listening,
		name: "Stop at once",
		async run(model) {
			await model.page.getByRole("button", { name: "Stop dictation" }).click();
			await expectOutcome(model);
		},
	},
	{
		enabled: listening,
		name: "Escape in the document",
		async run(model) {
			await dictationDocument(model.page).focus();
			await model.page.keyboard.press("Escape");
			await expect(dictationStatus(model.page)).toHaveText(
				"Dictation cancelled.",
			);
			await expectOutcome(model);
		},
	},
	{
		enabled: listening,
		name: "Cancel",
		async run(model) {
			await model.page.getByRole("button", { name: "Cancel" }).click();
			await expect(dictationStatus(model.page)).toHaveText(
				"Dictation cancelled.",
			);
			await expectOutcome(model);
		},
	},
	{
		enabled: listening,
		name: "Reload while listening",
		async run(model) {
			await reloadWorkspace(model.page);
			model.listening = false;
			await expect(dictationStatus(model.page)).toHaveText("Ready to dictate.");
		},
	},
];

for (const seed of charterSeeds())
	test(`AC1 web dictation triggers, seed ${seed}`, async ({
		workspace,
	}, testInfo) => {
		const started = await workspace();
		const model: Model = {
			doc: "",
			lastNumber: 0,
			listening: false,
			page: started.page,
			saved: 0,
			workspace: started,
		};
		await walk({
			actions,
			async check(current) {
				const status =
					(await dictationStatus(current.page).textContent()) ?? "";
				if (current.listening) expect(status).toBe("Listening…");
				else
					expect(RESTING, `resting state, got "${status}"`).toContain(status);
				await expect(dictationDocument(current.page)).toHaveValue(current.doc);
				// A cancel, a tap or a reload never leaves a recording behind.
				expect(current.workspace.library.recordings()).toHaveLength(
					current.saved,
				);
			},
			model,
			persona: SPEEDRUNNER,
			seed,
			testInfo,
		});
		// The page still works after the walk.
		if (model.listening) {
			await recordFor(model.page, 1);
			await model.page.getByRole("button", { name: "Stop dictation" }).click();
			await expectOutcome(model);
		}
		await model.page.getByRole("button", { name: "Start dictation" }).click();
		model.listening = true;
		await recordFor(model.page, 1);
		await model.page.getByRole("button", { name: "Stop dictation" }).click();
		await expectOutcome(model);
		expect(await dictationStatus(model.page).textContent()).toBe(ADDED);
	});
