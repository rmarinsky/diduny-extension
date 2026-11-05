import type { Locator } from "@playwright/test";
import {
	deliveryNotice,
	dictate,
	expect,
	panelTranscript,
	test,
} from "./support/extension-harness";

const FOCUS_A_FIELD =
	"Focus a supported text field to insert dictation. Copy the transcript instead.";
const TARGET_GONE =
	"The original text field is no longer available. Copy the transcript instead.";
const BROWSER_PAGE =
	"Diduny cannot type into browser pages like this one. Copy the transcript instead.";
const RESULT = /Mock transcript \d+/;

/** The page's "Diduny is recording" pill. */
const PILL = "#__diduny-delivery-status";

/** Puts the caret (or a selection) inside a contenteditable's first text node. */
async function selectText(editor: Locator, start: number, end = start) {
	await editor.evaluate(
		(element, [from, to]) => {
			(element as HTMLElement).focus();
			const node = element.firstChild ?? element;
			const range = document.createRange();
			range.setStart(node, from);
			range.setEnd(node, to);
			const selection = document.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
		},
		[start, end] as const,
	);
}

test("TC-16: with no field focused nothing is typed into another field, and the panel asks to focus a field", async ({
	extension,
}) => {
	const session = await extension({ page: "delivery" });
	const { fixture, panel } = session;
	const message = fixture.getByLabel("Message");
	const notes = fixture.getByLabel("Notes");
	await fixture.getByText("Below the message box").click();
	expect(await fixture.evaluate(() => document.activeElement?.tagName)).toBe(
		"BODY",
	);

	// BUG-E1: the result went into the page's first contenteditable box.
	await dictate(session, {
		whileRecording: () => expect(fixture.locator(PILL)).toHaveCount(0),
	});
	await expect(message).toHaveValue("typed message");
	expect(await notes.textContent()).toBe("Notes: ");
	await expect(deliveryNotice(panel)).toHaveText(FOCUS_A_FIELD);
	await expect(panelTranscript(panel)).toHaveValue(RESULT);
});

test("TC-17: the result lands at the caret in the middle of text or replaces the selection in every supported field type", async ({
	extension,
}) => {
	const session = await extension({ page: "caret" });
	const { editorUrl, fixture } = session;
	const message = fixture.getByLabel("Message");

	await message.fill("START END");
	await message.evaluate((field: HTMLTextAreaElement) =>
		field.setSelectionRange(6, 6),
	);
	await dictate(session);
	await expect(message).toHaveValue(/^START Mock transcript \d+END$/);
	const inserted = (await message.inputValue()).length - "START END".length;
	expect(
		await message.evaluate((field: HTMLTextAreaElement) => [
			field.selectionStart,
			field.selectionEnd,
		]),
	).toEqual([6 + inserted, 6 + inserted]);

	await message.fill("KEEP REPLACE-ME KEEP");
	await message.evaluate((field: HTMLTextAreaElement) =>
		field.setSelectionRange(5, 15),
	);
	await dictate(session);
	await expect(message).toHaveValue(/^KEEP Mock transcript \d+ KEEP$/);

	const subject = fixture.getByLabel("Subject");
	await subject.fill("ab");
	await subject.evaluate((field: HTMLInputElement) =>
		field.setSelectionRange(1, 1),
	);
	await dictate(session);
	await expect(subject).toHaveValue(/^aMock transcript \d+b$/);

	const notes = fixture.getByLabel("Notes");
	await notes.evaluate((element) => {
		element.textContent = "KEEP REPLACE-ME KEEP";
	});
	await selectText(notes, 5, 15);
	await dictate(session);
	await expect(notes).toHaveText(/^KEEP Mock transcript \d+ KEEP$/);

	for (const [editor, text] of [
		["contenteditable", "Contenteditable "],
		["notion", "Notion "],
		["linear", "Linear "],
		["slack", "Slack "],
		["prosemirror", "ProseMirror "],
	] as const) {
		await fixture.goto(editorUrl(editor));
		const target = fixture.locator("#editor");
		await selectText(target, 2);
		await dictate(session);
		const value = (await target.textContent()) ?? "";
		expect(value, editor).toMatch(
			new RegExp(`^${text.slice(0, 2)}Mock transcript \\d+${text.slice(2)}$`),
		);
		await expect(fixture.locator("#events")).toContainText(
			"beforeinput:insertText;",
		);
		await expect(fixture.locator("#events")).toContainText("input:insertText;");
	}
});

test("TC-18: text typed into the field during recording stays before the inserted result", async ({
	extension,
}) => {
	const session = await extension();
	const message = session.fixture.getByLabel("Message");
	await message.focus();
	// BUG-E4: the result went in at the caret saved at Start, in front of the typed text.
	await dictate(session, {
		whileRecording: async () => {
			await message.pressSequentially("typed during recording");
			await expect(message).toHaveValue("typed during recording");
		},
	});
	await expect(message).toHaveValue(
		/^typed during recordingMock transcript \d+$/,
	);
});

test("TC-19: a read-only field, a focused button and a disabled field get nothing and show the 'Focus a supported text field' notice", async ({
	extension,
}) => {
	const session = await extension({ page: "fields" });
	const { fixture, panel } = session;
	const readOnly = fixture.getByLabel("Read-only notes");
	const disabled = fixture.getByLabel("Disabled notes");

	await readOnly.focus();
	await dictate(session, {
		whileRecording: () => expect(fixture.locator(PILL)).toHaveCount(0),
	});
	await expect(readOnly).toHaveValue("Read only");
	await expect(deliveryNotice(panel)).toHaveText(FOCUS_A_FIELD);

	await fixture.getByRole("button", { name: "Send" }).focus();
	await dictate(session, {
		whileRecording: () => expect(fixture.locator(PILL)).toHaveCount(0),
	});
	await expect(deliveryNotice(panel)).toHaveText(FOCUS_A_FIELD);

	// A disabled field cannot take focus, so the click leaves the page body focused.
	await disabled.click({ force: true });
	await dictate(session, {
		whileRecording: () => expect(fixture.locator(PILL)).toHaveCount(0),
	});
	await expect(disabled).toHaveValue("Disabled");
	await expect(readOnly).toHaveValue("Read only");
	await expect(deliveryNotice(panel)).toHaveText(FOCUS_A_FIELD);
});

test("TC-20: switching to another tab during recording still inserts into the original field", async ({
	extension,
}) => {
	const session = await extension();
	const { context, fixture, pageUrl, panel } = session;
	const message = fixture.getByLabel("Message");
	await message.fill("A ");
	await message.focus();
	const tabB = await context.newPage();
	await tabB.goto(pageUrl("page-b"));
	await fixture.bringToFront();

	await dictate(session, {
		whileRecording: async () => {
			await tabB.bringToFront();
			await tabB.getByLabel("Message").focus();
		},
	});
	await expect(message).toHaveValue(/^A Mock transcript \d+$/);
	expect(await fixture.evaluate(() => document.activeElement?.id)).toBe(
		"message",
	);
	await expect(tabB.getByLabel("Message")).toHaveValue("");
	await expect(deliveryNotice(panel)).toBeHidden();
});

test("TC-21: when the page navigates during recording the panel says the text was not inserted", async ({
	extension,
}) => {
	const session = await extension();
	const { fixture, pageUrl, panel } = session;
	await fixture.getByLabel("Message").focus();
	// BUG-E8: the panel said Done and nothing else.
	await dictate(session, {
		whileRecording: async () => {
			await fixture.goto(pageUrl("page-b"));
			await fixture.getByLabel("Message").focus();
		},
	});
	await expect(fixture.getByRole("heading", { name: "Page B" })).toBeVisible();
	await expect(fixture.getByLabel("Message")).toHaveValue("");
	await expect(deliveryNotice(panel)).toHaveText(TARGET_GONE);
	await expect(panelTranscript(panel)).toHaveValue(RESULT);
});

test("TC-22: a field removed during recording gets the 'original text field is no longer available' notice", async ({
	extension,
}) => {
	const session = await extension();
	const { fixture, panel } = session;
	await fixture.getByLabel("Message").focus();
	await dictate(session, {
		whileRecording: async () => {
			await expect(fixture.locator(PILL)).toHaveText("Diduny is recording");
			await fixture.getByLabel("Message").evaluate((field) => field.remove());
			await expect(fixture.getByLabel("Message")).toHaveCount(0);
		},
	});
	await expect(deliveryNotice(panel)).toHaveText(TARGET_GONE);
	await expect(fixture.locator(PILL)).toHaveCount(0);
});

test("TC-23: Ukrainian, multi-line and 6,000-character results are inserted unchanged", async ({
	extension,
}) => {
	const session = await extension({ page: "caret" });
	const { fixture, mock, override, panel } = session;
	// Realtime is down, so the result comes from the upload, which returns these texts.
	mock.setBehavior("/api/v1/realtime", "server_error");
	const answer = (text: string) =>
		override("POST /api/v1/transcriptions", { body: { text, tokens: [] } });
	const message = fixture.getByLabel("Message");

	const ukrainian = "Привіт, світ!\nДругий рядок — «лапки», апостроф’ і ґ.";
	answer(ukrainian);
	await message.focus();
	await dictate(session, { waitForAudio: false });
	await expect(message).toHaveValue(ukrainian);
	expect((await panelTranscript(panel).inputValue()).endsWith(ukrainian)).toBe(
		true,
	);

	answer("Привіт, світ!\nДругий рядок.");
	const notes = fixture.getByLabel("Notes");
	await notes.focus();
	await dictate(session, { waitForAudio: false });
	expect(
		(await notes.evaluate((element) => (element as HTMLElement).innerText))
			.split("\n")
			.filter(Boolean),
	).toEqual(["Привіт, світ!", "Другий рядок."]);

	const long = Array.from({ length: 1_000 }, () => "слово").join(" ");
	expect(long).toHaveLength(5_999);
	answer(long);
	await message.fill("");
	await message.focus();
	await dictate(session, { waitForAudio: false });
	await expect(message).toHaveValue(long);
});

test("TC-24: a site disabled in Settings before recording gets nothing; Enable restores delivery", async ({
	extension,
}) => {
	const session = await extension();
	const { fixture, openExtensionPage, pageUrl, panel } = session;
	const origin = new URL(pageUrl("plain")).origin;
	const options = await openExtensionPage("options.html");
	await options.getByLabel("Disable direct delivery on a site").fill(origin);
	await options.getByRole("button", { name: "Disable site" }).click();
	await expect(
		options.getByText(`Delivery disabled for ${origin}.`),
	).toBeVisible();
	await expect(options.getByText(origin, { exact: true })).toBeVisible();

	const message = fixture.getByLabel("Message");
	await message.focus();
	await dictate(session, {
		whileRecording: () => expect(fixture.locator(PILL)).toHaveCount(0),
	});
	await expect(message).toHaveValue("");
	await expect(deliveryNotice(panel)).toHaveText(
		"Delivery is disabled for this site. Copy the transcript instead.",
	);

	await options.bringToFront();
	await options.getByRole("button", { name: `Enable ${origin}` }).click();
	await expect(
		options.getByText(`Delivery enabled for ${origin}.`),
	).toBeVisible();
	await expect(
		options.getByText("Direct delivery is enabled on every site you allow."),
	).toBeVisible();

	await message.focus();
	await dictate(session);
	await expect(message).toHaveValue(RESULT);
});

test("TC-25: on the New Tab page or about:blank the panel explains that it cannot type there", async ({
	extension,
}) => {
	const session = await extension();
	const { context, panel } = session;
	// BUG-E12: both pages were reported as "Delivery is disabled for this site".
	for (const url of ["chrome://newtab/", "about:blank"]) {
		const browserPage = await context.newPage();
		await browserPage.goto(url);
		await dictate(session, { target: browserPage });
		await expect(deliveryNotice(panel), url).toHaveText(BROWSER_PAGE);
		await expect(panelTranscript(panel)).toHaveValue(/Mock transcript \d+$/);
		await browserPage.close();
	}
});
