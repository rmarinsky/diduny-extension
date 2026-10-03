import type { Page } from "@playwright/test";
import { appendTranscript } from "../../web/src/dictation";
import {
	type CharterAction,
	SPEEDRUNNER,
	charterSeeds,
	walk,
} from "../support/charter";
import {
	type ExtensionSession,
	TEST_EMAIL,
	badgeText,
	clickRecord,
	expect,
	panelSignedIn,
	panelTranscript,
	stateLabel,
	test,
} from "../support/extension-harness";
import { signIn } from "../support/web-workspace";

// Charter AC2 (extension): Record/Stop and the panel's Transcript under a
// Speedrunner who double-clicks, reopens and closes the panel, types, clears,
// undoes and copies. Invariants: the Transcript always equals the model (no
// lost or doubled text), the panel's state matches the background's, every
// accepted Record is exactly one start, and the badge clears afterwards.

interface Model {
	/** Clear was the last action, so Ctrl+Z can bring the text back. */
	canUndo: boolean;
	cleared: string;
	ext: ExtensionSession;
	lastNumber: number;
	panel: Page;
	starts: number;
	transcript: string;
}

async function waitFor(panel: Page, label: string, timeout = 30_000) {
	await expect(stateLabel(panel)).toHaveText(label, { timeout });
}

/** The panel's Transcript after one more result: the old text, a --- line, "Mock transcript N". */
async function expectAppended(model: Model) {
	const prefix = appendTranscript(model.transcript, "X").slice(0, -1);
	const value = await panelTranscript(model.panel).inputValue();
	expect(value.startsWith(prefix), "the Transcript kept its text").toBe(true);
	const added = value.slice(prefix.length).match(/^Mock transcript (\d+)$/);
	expect(
		added,
		`one result appended, got ${JSON.stringify(value)}`,
	).not.toBeNull();
	const number = Number(added?.[1]);
	expect(number).toBeGreaterThan(model.lastNumber);
	model.lastNumber = number;
	model.transcript = value;
}

async function record(model: Model, { doubleClick }: { doubleClick: boolean }) {
	const { fixture } = model.ext;
	await fixture.getByLabel("Message").focus();
	await fixture.bringToFront();
	await clickRecord(model.panel);
	if (doubleClick) await clickRecord(model.panel);
	await waitFor(model.panel, "Recording...");
	await fixture.waitForTimeout(1_200);
	await clickRecord(model.panel);
	await waitFor(model.panel, "Done");
	model.starts += 1;
	await expectAppended(model);
}

const notUndo =
	(run: CharterAction<Model>["run"]): CharterAction<Model>["run"] =>
	async (model, random) => {
		model.canUndo = false;
		await run(model, random);
	};

const actions: CharterAction<Model>[] = [
	{
		name: "Dictate",
		run: notUndo((model) => record(model, { doubleClick: false })),
		weight: 3,
	},
	{
		name: "Double-click Record, then stop",
		run: notUndo((model) => record(model, { doubleClick: true })),
	},
	{
		name: "Reopen the panel",
		run: notUndo(async (model) => {
			await model.panel.reload();
			await panelSignedIn(model.panel);
		}),
	},
	{
		name: "Close the panel and open a new one",
		run: notUndo(async (model) => {
			await model.panel.close();
			model.panel = await model.ext.openExtensionPage("sidepanel.html");
			await panelSignedIn(model.panel);
		}),
	},
	{
		name: "Type in the Transcript",
		run: notUndo(async (model, random) => {
			const word = ` typed${Math.floor(random() * 1_000)}`;
			await model.panel.bringToFront();
			await panelTranscript(model.panel).click();
			await model.panel.keyboard.press("Control+End");
			await model.panel.keyboard.type(word);
			model.transcript += word;
		}),
	},
	{
		enabled: (model) => model.transcript !== "",
		name: "Clear",
		async run(model) {
			await model.panel.bringToFront();
			await model.panel.getByRole("button", { name: "Clear" }).click();
			model.cleared = model.transcript;
			model.transcript = "";
			model.canUndo = true;
		},
	},
	{
		enabled: (model) => model.canUndo,
		name: "Undo the Clear with Ctrl+Z",
		run: notUndo(async (model) => {
			await expect(panelTranscript(model.panel)).toBeFocused();
			await model.panel.keyboard.press("Control+Z");
			model.transcript = model.cleared;
		}),
	},
	{
		enabled: (model) => model.transcript !== "",
		name: "Copy",
		run: notUndo(async (model) => {
			await model.panel.bringToFront();
			await model.panel.getByRole("button", { name: "Copy" }).click();
			await expect(
				model.panel.getByRole("button", { name: "Copied!" }),
			).toBeVisible();
		}),
	},
	{
		name: "Log out and sign in again",
		weight: 0.5,
		run: notUndo(async (model) => {
			const { web } = model.ext;
			await model.panel.bringToFront();
			await model.panel.getByRole("button", { name: "Logout" }).click();
			await web.reload();
			await signIn(web);
			await model.panel.bringToFront();
			await model.panel.getByRole("button", { name: "I signed in" }).click();
			await expect(model.panel.getByText(TEST_EMAIL)).toBeVisible();
			// Logout clears the panel's Transcript, as the web app clears its draft.
			model.transcript = "";
		}),
	},
];

for (const seed of charterSeeds())
	test(`AC2 extension recording and Transcript, seed ${seed}`, async ({
		extension,
	}, testInfo) => {
		const ext = await extension();
		const model: Model = {
			canUndo: false,
			cleared: "",
			ext,
			lastNumber: 0,
			panel: ext.panel,
			starts: 0,
			transcript: "",
		};
		await walk({
			actions,
			async check(current) {
				const { panel } = current;
				await expect(panelTranscript(panel)).toHaveValue(current.transcript);
				const running = (await panel.evaluate(
					() =>
						new Promise((resolve) =>
							chrome.runtime.sendMessage(
								{ type: "getRecordingState" },
								resolve,
							),
						),
				)) as { state: string };
				const label = (await stateLabel(panel).textContent()) ?? "";
				// While something records the panel must say so; at rest a reopened panel
				// may show Ready where the background still remembers its last Done.
				const busy = {
					processing: "Processing...",
					recording: "Recording...",
					starting: "Starting...",
				}[running.state];
				if (busy) expect(label, `background ${running.state}`).toBe(busy);
				else
					expect(
						["Ready", "Done", "Error"],
						`background ${running.state}`,
					).toContain(label);
				// One saved recording per accepted Record: a double click never captures twice.
				// (The extension log keeps only 100 lines, so it cannot count long walks.)
				await expect
					.poll(() => current.ext.library.recordings().length)
					.toBe(current.starts);
				await expect.poll(() => badgeText(current.ext.worker)).toBe("");
			},
			model,
			persona: SPEEDRUNNER,
			seed,
			testInfo,
		});
	});
