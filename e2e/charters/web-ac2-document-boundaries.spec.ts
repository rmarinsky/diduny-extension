import type { Page } from "@playwright/test";
import { appendTranscript } from "../../web/src/dictation";
import { charterSeeds, pick, seededRandom } from "../support/charter";
import {
	dictationDocument,
	dictationStatus,
	disableRealtime,
	expect,
	test,
} from "../support/web-workspace";

// Charter AC2 (web): the Dictation document at its boundaries. The oracle is
// the app's own append rule (web/src/dictation.ts): whatever the document
// holds and wherever the caret is, the result lands at the end, below a ---
// line, and nothing else changes.

const DOCUMENTS: Array<{
	caret: [number, number] | "end";
	name: string;
	text: string;
}> = [
	{ caret: [0, 0], name: "empty", text: "" },
	{ caret: [2, 2], name: "whitespace only", text: "   \n\t  " },
	{ caret: [0, 0], name: "100,000 characters", text: "word ".repeat(20_000) },
	{
		caret: [9, 13],
		name: "Ukrainian and emoji, a selection",
		text: "Привіт 👋 — «тест» ґ і ї",
	},
	{ caret: "end", name: "Windows line endings", text: "line one\r\nline two" },
	{ caret: "end", name: "ends with a separator", text: "Before\n---\n" },
	{
		caret: [4, 4],
		name: "trailing spaces, caret inside",
		text: "trailing spaces   ",
	},
];

async function prepare(
	page: Page,
	text: string,
	caret: [number, number] | "end",
) {
	const document = dictationDocument(page);
	await document.fill(text);
	await document.evaluate((field, range) => {
		const input = field as HTMLTextAreaElement;
		const [start, end] =
			range === "end" ? [input.value.length, input.value.length] : range;
		input.focus();
		input.setSelectionRange(start, end);
	}, caret);
	// The browser stores the text as typed in a textarea, Windows line endings become \n.
	return document.inputValue();
}

async function dictate(page: Page) {
	await page.getByRole("button", { name: "Start dictation" }).click();
	await expect(dictationStatus(page)).toHaveText("Listening…");
	await expect(page.locator(".meter-row output")).toHaveText(/^[1-9]s$/);
	await page.getByRole("button", { name: "Stop dictation" }).click();
}

/**
 * "Mock transcript N" has a number the test cannot know, so the text before
 * it is compared exactly and the rest matched (a 100,000-character pattern is
 * too large for a regular expression).
 */
async function expectAppended(page: Page, before: string, label: string) {
	const prefix = appendTranscript(before, "X").slice(0, -1);
	const value = await dictationDocument(page).inputValue();
	expect(value.startsWith(prefix), `${label}: the old text stays first`).toBe(
		true,
	);
	expect(value.slice(prefix.length), label).toMatch(/^Mock transcript \d+$/);
}

test("AC2 web: every boundary document gets the transcript appended at the end", async ({
	workspace,
}) => {
	test.setTimeout(240_000);
	const { page } = await workspace();
	for (const { caret, name, text } of DOCUMENTS) {
		const before = await prepare(page, text, caret);
		await dictate(page);
		await expect(dictationStatus(page), name).toHaveText(
			"Dictation added to this document.",
			{ timeout: 30_000 },
		);
		await expectAppended(page, before, name);
	}
});

test("AC2 web: a Ukrainian multi-line result is appended unchanged to every boundary document", async ({
	workspace,
}) => {
	test.setTimeout(240_000);
	const { mock, override, page } = await workspace();
	const result = "Рядок один, «лапки» і ґ.\nРядок два — апостроф’.";
	disableRealtime(mock);
	override("POST /api/v1/transcriptions", {
		body: { text: result, tokens: [] },
	});
	for (const { caret, name, text } of DOCUMENTS.filter(
		(document) => document.text.length < 1_000,
	)) {
		const before = await prepare(page, text, caret);
		await dictate(page);
		await expect(dictationStatus(page), name).toHaveText(
			"Dictation added to this document.",
			{ timeout: 30_000 },
		);
		await expect(dictationDocument(page), name).toHaveValue(
			appendTranscript(before, result),
		);
	}
});

for (const seed of charterSeeds())
	test(`AC2 web: text typed while listening and while transcribing stays before the result, seed ${seed}`, async ({
		workspace,
	}) => {
		test.setTimeout(240_000);
		const random = seededRandom(seed);
		const { mock, page } = await workspace();
		disableRealtime(mock);
		// The upload waits for the test, so typing happens while it is "Transcribing".
		let release: () => void = () => {};
		await page.route("**/bff/api/transcriptions", async (route) => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			await route.continue();
		});
		const document = dictationDocument(page);
		const words = [
			"alpha",
			"Привіт",
			"ґанок",
			"two words",
			"3.14",
			"«лапки»",
			"end.",
		];
		for (let round = 0; round < 3; round += 1) {
			const start = random() < 0.5 ? "" : `${pick(random, words)} `;
			await prepare(page, start, "end");
			await page.getByRole("button", { name: "Start dictation" }).click();
			await expect(dictationStatus(page)).toHaveText("Listening…");
			const whileListening = ` ${pick(random, words)}`;
			await document.focus();
			await page.keyboard.press("Control+End");
			await page.keyboard.type(whileListening);
			await expect(page.locator(".meter-row output")).toHaveText(/^[1-9]s$/);
			await page.getByRole("button", { name: "Stop dictation" }).click();
			await expect(dictationStatus(page)).toHaveText(
				"Realtime is unavailable. Transcribing the completed recording…",
				{ timeout: 30_000 },
			);
			const whileTranscribing = ` ${pick(random, words)}`;
			await document.focus();
			await page.keyboard.press("Control+End");
			await page.keyboard.type(whileTranscribing);
			const typed = await document.inputValue();
			expect(typed).toBe(`${start}${whileListening}${whileTranscribing}`);
			release();
			await expect(dictationStatus(page)).toHaveText(
				"Dictation added to this document.",
				{ timeout: 30_000 },
			);
			await expectAppended(page, typed, `round ${round + 1}`);
		}
	});
