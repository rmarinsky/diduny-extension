import type { Frame, Locator, Page } from "@playwright/test";
import Fastify from "fastify";
import {
	type ExtensionSession,
	clickRecord,
	deliveryNotice,
	dictate,
	expect,
	stateLabel,
	test,
} from "../support/extension-harness";

// Charter AC3 (extension): delivery into every kind of field, at every caret,
// with interruptions. One invariant for all of it: the result lands at the
// focused field's caret and nothing else on the page changes, or it lands
// nowhere and the panel says why. Text in the wrong place, or a silent
// failure, fails the charter.

type Caret = [number, number] | "end";
type Expect = "insert" | "notice" | "either";

interface Case {
	before: string;
	caret: Caret;
	expect: Expect;
	field(session: ExtensionSession, page: Page): Promise<Locator>;
	name: string;
	page: string;
}

const RESULT = /Mock transcript \d+/;

/** Every field value on the page and in the frames Playwright can reach. */
async function snapshot(page: Page) {
	const values: string[] = [];
	for (const frame of page.frames())
		values.push(
			...(await frame
				.evaluate(() =>
					[
						...document.querySelectorAll<HTMLElement>(
							'input, textarea, [contenteditable="true"]',
						),
					].map((element) =>
						element instanceof HTMLInputElement ||
						element instanceof HTMLTextAreaElement
							? `${element.getAttribute("aria-label")}=${element.value}`
							: `${element.getAttribute("aria-label")}=${element.textContent}`,
					),
				)
				.catch(() => [] as string[])),
		);
	return values;
}

async function readField(field: Locator) {
	return field.evaluate((element) =>
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement
			? element.value
			: (element.textContent ?? ""),
	);
}

async function placeCaret(field: Locator, caret: Caret) {
	await field.evaluate((element, range) => {
		const control = element as HTMLInputElement;
		if ("value" in control && typeof control.setSelectionRange === "function") {
			control.focus();
			const [start, end] =
				range === "end" ? [control.value.length, control.value.length] : range;
			try {
				control.setSelectionRange(start, end);
			} catch {
				// Email and number inputs have no selection API.
			}
			return;
		}
		const editable = element as HTMLElement;
		editable.focus();
		const node = editable.firstChild ?? editable;
		const length = node.textContent?.length ?? 0;
		const [start, end] = range === "end" ? [length, length] : range;
		const selection = document.getSelection();
		const selected = document.createRange();
		selected.setStart(node, start);
		selected.setEnd(node, end);
		selection?.removeAllRanges();
		selection?.addRange(selected);
	}, caret);
}

async function prepare(field: Locator, before: string) {
	await field.evaluate((element, text) => {
		if (
			element instanceof HTMLInputElement ||
			element instanceof HTMLTextAreaElement
		)
			element.value = text;
		else element.textContent = text;
	}, before);
}

/** Where `caret` puts the result in `before`. */
function inserted(before: string, caret: Caret, result: string) {
	const [start, end] = caret === "end" ? [before.length, before.length] : caret;
	return `${before.slice(0, start)}${result}${before.slice(end)}`;
}

async function check(
	session: ExtensionSession,
	page: Page,
	field: Locator,
	{
		before,
		caret,
		expect: expected,
		name,
	}: Pick<Case, "before" | "caret" | "expect" | "name">,
	whileRecording?: () => Promise<void>,
) {
	const fieldLabel = await field.getAttribute("aria-label");
	const others = (await snapshot(page)).filter(
		(value) => !value.startsWith(`${fieldLabel}=`),
	);
	// Not waiting for realtime audio: the charter is about where the text lands,
	// and an occasional refused realtime socket (BUG-E23) only delays it.
	await dictate(session, { target: page, waitForAudio: false, whileRecording });
	const value = await readField(field);
	const match = value.match(RESULT);
	const landed = match ? inserted(before, caret, match[0]) === value : false;
	const nothing = value === before;
	const notice = await deliveryNotice(session.panel).isVisible();
	test.info().annotations.push({
		description: landed
			? "inserted at the caret"
			: nothing
				? `not inserted: ${await deliveryNotice(session.panel)
						.textContent()
						.catch(() => "")}`
				: `changed to ${JSON.stringify(value)}`,
		type: name,
	});
	expect(
		landed || nothing,
		`${name}: text went somewhere other than the caret`,
	).toBe(true);
	if (nothing)
		expect(notice, `${name}: not inserted, and the panel said nothing`).toBe(
			true,
		);
	if (expected === "insert")
		expect(landed, `${name}: expected the result at the caret`).toBe(true);
	if (expected === "notice")
		expect(nothing, `${name}: expected nothing inserted`).toBe(true);
	expect(
		(await snapshot(page)).filter(
			(entry) => !entry.startsWith(`${fieldLabel}=`),
		),
		`${name}: another field changed`,
	).toEqual(others);
}

const inPage =
	(label: string) => async (_session: ExtensionSession, page: Page) =>
		page.getByLabel(label, { exact: true });

const inFrame =
	(label: string) => async (_session: ExtensionSession, page: Page) => {
		const frame = await embedded(page);
		return frame.getByLabel(label, { exact: true });
	};

async function embedded(page: Page): Promise<Frame> {
	await expect.poll(() => page.frames().length).toBeGreaterThan(1);
	const frame = page.frames()[1] as Frame;
	await frame.waitForLoadState();
	return frame;
}

const TEXT_CONTROLS = ["text input", "search input", "url input", "tel input"];
const CARETS: Array<[string, Caret]> = [
	["at the start", [0, 0]],
	["in the middle", [2, 2]],
	["over a selection", [1, 4]],
];

const CASES: Case[] = [
	...CARETS.map(
		([where, caret]): Case => ({
			before: "START END",
			caret,
			expect: "insert",
			field: inPage("Message"),
			name: `textarea, caret ${where}`,
			page: "caret",
		}),
	),
	...TEXT_CONTROLS.flatMap((label) =>
		CARETS.map(
			([where, caret]): Case => ({
				before: "ab cd",
				caret,
				expect: "insert",
				field: inPage(label),
				name: `${label}, caret ${where}`,
				page: "inputs",
			}),
		),
	),
	{
		before: "user@",
		caret: "end",
		expect: "insert",
		field: inPage("email input"),
		name: "email input",
		page: "inputs",
	},
	{
		before: "secret",
		caret: "end",
		expect: "notice",
		field: inPage("password input"),
		name: "password input",
		page: "inputs",
	},
	{
		before: "42",
		caret: "end",
		expect: "notice",
		field: inPage("number input"),
		name: "number input",
		page: "inputs",
	},
	...CARETS.map(
		([where, caret]): Case => ({
			before: "KEEP REPLACE-ME KEEP",
			caret,
			expect: "insert",
			field: inPage("Notes"),
			name: `contenteditable, caret ${where}`,
			page: "caret",
		}),
	),
	{
		before: "inside",
		caret: "end",
		expect: "insert",
		field: inFrame("Message"),
		name: "textarea in a same-origin frame",
		page: "framed",
	},
	{
		before: "",
		caret: "end",
		expect: "either",
		field: inPage("Shadow input"),
		name: "input in a shadow root",
		page: "shadow",
	},
];

/** A second origin: another localhost port Diduny may use, or 127.0.0.1, which it may not. */
async function frameServer(host: string) {
	const server = Fastify();
	server.get("/frame", async (_request, reply) =>
		reply
			.type("text/html")
			.send(
				'<!doctype html><meta charset="utf-8"><textarea aria-label="Frame field"></textarea>',
			),
	);
	await server.listen({ host, port: 0 });
	const address = server.server.address();
	if (!address || typeof address === "string") throw new Error("No port");
	return {
		close: () => server.close(),
		url: `http://${host === "127.0.0.1" ? "127.0.0.1" : "localhost"}:${address.port}/frame`,
	};
}

test("AC3 extension: every field kind and caret gets the result at the caret, or a notice", async ({
	extension,
}) => {
	test.setTimeout(300_000);
	const session = await extension();
	const { fixture, pageUrl } = session;
	for (const testCase of CASES) {
		await fixture.goto(pageUrl(testCase.page));
		const field = await testCase.field(session, fixture);
		await prepare(field, testCase.before);
		await placeCaret(field, testCase.caret);
		await check(session, fixture, field, testCase);
	}
});

test("AC3 extension: frames from other origins, and a field next to one", async ({
	extension,
}) => {
	test.setTimeout(180_000);
	const session = await extension();
	const { fixture, pageUrl } = session;
	const permitted = await frameServer("localhost");
	const thirdParty = await frameServer("127.0.0.1");
	try {
		for (const [name, frameUrl, expected] of [
			[
				"textarea in a frame on another localhost port",
				permitted.url,
				"insert",
			],
			[
				"textarea in a third-party frame Diduny cannot access",
				thirdParty.url,
				"either",
			],
		] as const) {
			await fixture.goto(
				`${pageUrl("framed")}?frame=${encodeURIComponent(frameUrl)}`,
			);
			const field = (await embedded(fixture)).getByLabel("Frame field");
			await prepare(field, "framed");
			await placeCaret(field, "end");
			await check(session, fixture, field, {
				before: "framed",
				caret: "end",
				expect: expected,
				name,
			});
		}
		// A third-party frame on the page must not stop delivery into the page's own field.
		await fixture.goto(
			`${pageUrl("framed")}?frame=${encodeURIComponent(thirdParty.url)}`,
		);
		await embedded(fixture);
		const field = fixture.getByLabel("Message", { exact: true });
		await prepare(field, "top ");
		await placeCaret(field, "end");
		await check(session, fixture, field, {
			before: "top ",
			caret: "end",
			expect: "insert",
			name: "page field next to a third-party frame",
		});
	} finally {
		await permitted.close();
		await thirdParty.close();
	}
});

test("AC3 extension: a field that changes during the recording gets nothing, or the result at its caret, and never fails silently", async ({
	extension,
}) => {
	test.setTimeout(180_000);
	const session = await extension({ page: "caret" });
	const { fixture } = session;
	for (const [name, change] of [
		[
			"disabled",
			(element: HTMLTextAreaElement) => {
				element.disabled = true;
			},
		],
		[
			"made read-only",
			(element: HTMLTextAreaElement) => {
				element.readOnly = true;
			},
		],
		[
			"hidden",
			(element: HTMLTextAreaElement) => {
				element.style.display = "none";
			},
		],
	] as const) {
		await fixture.reload();
		const field = fixture.getByLabel("Message", { exact: true });
		await prepare(field, "before ");
		await placeCaret(field, "end");
		await check(
			session,
			fixture,
			field,
			// A disabled or read-only field must not be written to behind the user's back.
			{
				before: "before ",
				caret: "end",
				expect: name === "hidden" ? "either" : "notice",
				name: `field ${name} during the recording`,
			},
			() => field.evaluate(change),
		);
	}
	await expect(stateLabel(session.panel)).toHaveText("Done");
	await clickRecord(session.panel);
	await expect(stateLabel(session.panel)).toHaveText("Recording...");
});
