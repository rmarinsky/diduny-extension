import type { BrowserContext, Page } from "@playwright/test";
import {
	clickRecord,
	deliveryNotice,
	expect,
	micPermissionPages,
	panelError,
	recordButton,
	stateLabel,
	storageGet,
	test,
} from "./support/extension-harness";

const BLOCKED_ON_PAGE =
	"Microphone is blocked for Diduny. Allow it in Chrome's site settings for this extension, then try again.";

function nextPermissionPage(context: BrowserContext) {
	return context.waitForEvent("page", {
		predicate: (page) => page.url().includes("mic-permission"),
	});
}

/** Chrome's prompt cannot be answered from Playwright; fail getUserMedia the way Chrome does. */
async function failMicrophone(page: Page, message: string) {
	await page.evaluate((reason) => {
		Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
			configurable: true,
			value: async () => {
				throw new DOMException(reason, "NotAllowedError");
			},
		});
	}, message);
}

test("TC-13: the first recording without a grant opens the permission page; granting starts the recording and inserts the text", async ({
	extension,
}) => {
	const { context, fixture, mock, panel, worker } = await extension({
		micGranted: false,
	});
	const message = fixture.getByLabel("Message");
	await message.fill("Hello ");
	await message.focus();

	const opened = nextPermissionPage(context);
	await clickRecord(panel);
	const permission = await opened;
	await expect(
		permission.getByText(/choose Allow while visiting the site/),
	).toBeVisible();
	await expect(
		permission.getByText(/Allow this time is not enough/),
	).toBeVisible();

	// --use-fake-ui-for-media-stream answers Chrome's prompt with Allow.
	const closed = permission.waitForEvent("close");
	await permission
		.getByRole("button", { name: "Grant Microphone Access" })
		.click();
	await expect(permission.getByRole("status")).toHaveText(
		"Microphone access granted! You can close this tab.",
	);
	await closed;
	expect(await storageGet(worker, "micGranted")).toBe(true);
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect
		.poll(() => mock.realtimeFrames().some((frame) => frame.isBinary))
		.toBe(true);

	await fixture.bringToFront();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	await expect(message).toHaveValue(/^Hello Mock transcript \d+$/);
	await expect(message).toBeFocused();
});

test("TC-14: dismissing or blocking Chrome's prompt and closing the permission page each explain what to do", async ({
	extension,
}) => {
	const { context, fixture, panel, worker } = await extension({
		micGranted: false,
	});
	const message = fixture.getByLabel("Message");
	await message.focus();

	const opened = nextPermissionPage(context);
	await clickRecord(panel);
	const permission = await opened;
	const grant = permission.getByRole("button", {
		name: "Grant Microphone Access",
	});
	const status = permission.getByRole("status");

	await failMicrophone(permission, "Permission dismissed");
	await grant.click();
	await expect(status).toHaveText(
		"The prompt was closed. Click the button again and choose Allow while visiting the site.",
	);
	await failMicrophone(permission, "Permission denied");
	await grant.click();
	await expect(status).toHaveText(BLOCKED_ON_PAGE);

	await permission.close();
	await expect(stateLabel(panel)).toHaveText("Error");
	await expect(panelError(panel)).toHaveText(
		"Microphone access was not granted. Click record to try again.",
	);
	await expect(message).toHaveValue("");
	expect(await storageGet(worker, "micGranted")).toBeUndefined();

	const reopened = nextPermissionPage(context);
	await fixture.bringToFront();
	await clickRecord(panel);
	await reopened;
});

test("TC-15: while the permission page is open the panel shows it is waiting, and a second start opens no second page", async ({
	extension,
}) => {
	const { context, fixture, mock, panel, worker } = await extension({
		micGranted: false,
	});
	const message = fixture.getByLabel("Message");
	await message.focus();

	const opened = nextPermissionPage(context);
	await clickRecord(panel);
	const permission = await opened;
	// BUG-E7: the panel kept showing "Click to start" while it waited.
	await expect(stateLabel(panel)).toHaveText("Starting...");
	await expect(
		panel.getByText(
			"Allow microphone access in the Diduny tab that opened, then come back here.",
		),
	).toBeVisible();
	await expect(recordButton(panel)).toBeDisabled();
	// It also looks disabled, not ready to record.
	await expect(recordButton(panel)).toHaveCSS("opacity", "0.5");
	await expect(recordButton(panel)).toHaveCSS("cursor", "not-allowed");

	// A second start (a shortcut, or a panel reopened meanwhile) brings the page forward instead.
	await fixture.bringToFront();
	await panel.evaluate(() =>
		chrome.runtime.sendMessage({
			diarization: false,
			language: "uk",
			mode: "voice",
			type: "start-recording",
		}),
	);
	await expect
		.poll(() =>
			worker.evaluate(
				async () =>
					(
						await chrome.tabs.query({ active: true, lastFocusedWindow: true })
					)[0]?.url,
			),
		)
		.toContain("mic-permission");
	expect(micPermissionPages(context)).toHaveLength(1);
	await expect(deliveryNotice(panel)).toBeHidden();

	const closed = permission.waitForEvent("close");
	await permission
		.getByRole("button", { name: "Grant Microphone Access" })
		.click();
	await closed;
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect
		.poll(() => mock.realtimeFrames().some((frame) => frame.isBinary))
		.toBe(true);
	await fixture.bringToFront();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	await expect(message).toHaveValue(/^Mock transcript \d+$/);
	expect(micPermissionPages(context)).toHaveLength(0);
});

test("TC-36: a stale microphone grant asks for access again and the next click reopens the permission page", async ({
	extension,
}) => {
	// Chrome blocks the microphone: no fake prompt, and every prompt is denied.
	const { context, fixture, panel, worker } = await extension({
		microphone: "blocked",
	});
	await fixture.getByLabel("Message").focus();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Error");
	await expect(panelError(panel)).toHaveText(
		"Diduny needs microphone access. Click record to allow it.",
	);
	await expect.poll(() => storageGet(worker, "micGranted")).toBeUndefined();

	const opened = nextPermissionPage(context);
	await fixture.bringToFront();
	await clickRecord(panel);
	const permission = await opened;
	await permission
		.getByRole("button", { name: "Grant Microphone Access" })
		.click();
	await expect(permission.getByRole("status")).toHaveText(BLOCKED_ON_PAGE);
});
