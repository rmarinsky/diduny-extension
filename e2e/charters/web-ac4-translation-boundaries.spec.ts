import type { Page } from "@playwright/test";
import { MAX_TRANSLATION_QUERY_LENGTH } from "../../web/src/translation";
import {
	type CharterAction,
	NEW_USER,
	charterSeeds,
	pick,
	walk,
} from "../support/charter";
import {
	type Workspace,
	expect,
	reloadWorkspace,
	test,
} from "../support/web-workspace";

// Charter AC4 (web): paste-in translation at its size boundaries, and a New
// User who swaps languages over and over. Invariants: every request fits the
// query limit, no text is lost, duplicated or reordered, and the pair never
// translates a language into itself, in the UI, in storage or in the request.

const SIZES = [1, 1_999, 2_000, 2_001, 5_000, 6_000, 6_001, 10_000, 20_000];
const VARIANTS: Record<string, (length: number) => string> = {
	"Cyrillic without breaks": (length) => "ґ".repeat(length),
	"English sentences": (length) =>
		"This is a sentence. ".repeat(Math.ceil(length / 20)).slice(0, length),
	"Ukrainian sentences": (length) =>
		"Це речення номер один. ".repeat(Math.ceil(length / 23)).slice(0, length),
};

async function openPastePanel(page: Page) {
	await page.getByText("Paste-in translation", { exact: true }).click();
	await expect(page.getByLabel("Text to translate")).toBeVisible();
}

/** Records the text of every translation request the page sends. */
function watchRequests(page: Page) {
	const requests: Array<{ encoded: number; pair: string; text: string }> = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.pathname !== "/bff/api/translations") return;
		const text = url.searchParams.get("q") ?? "";
		requests.push({
			encoded: new URLSearchParams({ q: text }).toString().length - 2,
			pair: `${url.searchParams.get("sl")}->${url.searchParams.get("tl")}`,
			text,
		});
	});
	return requests;
}

const squeeze = (text: string) => text.replace(/\s+/g, "");

test("AC4 web: pasted text of every boundary size is sent in parts that fit and comes back whole", async ({
	workspace,
}) => {
	test.setTimeout(240_000);
	const { page } = await workspace();
	const requests = watchRequests(page);
	await openPastePanel(page);
	const input = page.getByLabel("Text to translate");
	const translate = page.getByRole("button", { name: "Translate pasted text" });
	const result = page.getByLabel("Translation result");

	// Nothing to translate: the button is off, or pressing it asks for text.
	for (const blank of ["", "   \n\t  "]) {
		await input.fill(blank);
		if (await translate.isDisabled()) continue;
		await translate.click();
		await expect(
			page.getByText("Paste text before translating it."),
			JSON.stringify(blank),
		).toBeVisible();
	}
	expect(requests).toHaveLength(0);

	for (const [variant, make] of Object.entries(VARIANTS))
		for (const size of SIZES) {
			const text = make(size);
			const label = `${variant}, ${size} characters`;
			const first = requests.length;
			await input.fill(text);
			await translate.click();
			await expect(
				page.getByText("Pasted text translated."),
				label,
			).toBeVisible({ timeout: 30_000 });
			const sent = requests.slice(first);
			expect(sent.length, label).toBeGreaterThan(0);
			for (const request of sent)
				expect(request.encoded, label).toBeLessThanOrEqual(
					MAX_TRANSLATION_QUERY_LENGTH,
				);
			expect(squeeze(sent.map((request) => request.text).join("")), label).toBe(
				squeeze(text),
			);
			const translated = (await result.textContent()) ?? "";
			expect(translated.split(" (uk->en)").length - 1, label).toBe(sent.length);
			expect(squeeze(translated.replaceAll(" (uk->en)", "")), label).toBe(
				squeeze(text),
			);
		}
});

interface PairModel {
	page: Page;
	requests: ReturnType<typeof watchRequests>;
	source: string;
	target: string;
	workspace: Workspace;
}

function pairGroup(page: Page) {
	return page.getByRole("group", { name: "Translation dictation languages" });
}

const pairActions: CharterAction<PairModel>[] = [
	{
		name: "Swap languages",
		async run(model) {
			await pairGroup(model.page)
				.getByRole("button", { name: "Swap languages" })
				.click();
			[model.source, model.target] = [model.target, model.source];
		},
	},
	{
		name: "Choose a From language",
		async run(model, random) {
			const language = pick(random, ["uk", "en"]);
			await pairGroup(model.page).getByLabel("From").selectOption(language);
			if (language === model.target) model.target = model.source;
			model.source = language;
		},
	},
	{
		name: "Choose a To language",
		async run(model, random) {
			const language = pick(random, ["uk", "en"]);
			await pairGroup(model.page).getByLabel("To").selectOption(language);
			if (language === model.source) model.source = model.target;
			model.target = language;
		},
	},
	{
		name: "Translate a word",
		async run(model) {
			const first = model.requests.length;
			await model.page.getByLabel("Text to translate").fill("Привіт");
			await model.page
				.getByRole("button", { name: "Translate pasted text" })
				.click();
			await expect(model.page.getByLabel("Translation result")).toHaveText(
				`Привіт (${model.source}->${model.target})`,
			);
			expect(
				model.requests.slice(first).map((request) => request.pair),
			).toEqual([`${model.source}->${model.target}`]);
		},
	},
	{
		name: "Reload",
		weight: 0.5,
		async run(model) {
			await reloadWorkspace(model.page);
			await openPastePanel(model.page);
		},
	},
];

for (const seed of charterSeeds())
	test(`AC4 web: repeated language swaps never pair a language with itself, seed ${seed}`, async ({
		workspace,
	}, testInfo) => {
		const started = await workspace();
		await openPastePanel(started.page);
		const model: PairModel = {
			page: started.page,
			requests: watchRequests(started.page),
			source: "uk",
			target: "en",
			workspace: started,
		};
		await walk({
			actions: pairActions,
			async check(current) {
				const group = pairGroup(current.page);
				await expect(group.getByLabel("From")).toHaveValue(current.source);
				await expect(group.getByLabel("To")).toHaveValue(current.target);
				expect(current.source).not.toBe(current.target);
				await expect
					.poll(() => {
						const settings = current.workspace.library.settings();
						return [
							settings.translationSourceLanguage,
							settings.translationTargetLanguage,
						];
					})
					.toEqual([current.source, current.target]);
			},
			model,
			persona: NEW_USER,
			seed,
			steps: Math.max(20, Number(process.env.CHARTER_STEPS ?? 20)),
			testInfo,
		});
	});
