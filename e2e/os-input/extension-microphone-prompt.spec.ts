import type { BrowserContext } from "@playwright/test";
import {
	clickRecord,
	expect,
	panelError,
	stateLabel,
	storageGet,
	test,
} from "../support/extension-harness";
import {
	osInputAvailable,
	pressBrowserButton,
	pressKeys,
} from "../support/os-input";

// Chrome's real microphone prompt, answered by clicking its buttons with UI Automation.
test.skip(!osInputAvailable, "Real OS input needs Windows");

const BLOCKED_ON_PAGE =
	"Microphone is blocked for Diduny. Allow it in Chrome's site settings for this extension, then try again.";
const NEEDS_ACCESS =
	"Diduny needs microphone access. Click record to allow it.";

function nextPermissionPage(context: BrowserContext) {
	return context.waitForEvent("page", {
		predicate: (page) => page.url().includes("mic-permission"),
	});
}

test("TC-13 (real prompt): 'Allow while visiting the site' grants the microphone and the recording inserts", async ({
	extension,
}) => {
	const { context, fixture, mock, panel, worker } = await extension({
		headed: true,
		micGranted: false,
		microphone: "prompt",
	});
	const message = fixture.getByLabel("Message");
	await message.fill("Hello ");
	await message.focus();

	const opened = nextPermissionPage(context);
	await clickRecord(panel);
	const permission = await opened;
	const closed = permission.waitForEvent("close");
	await permission
		.getByRole("button", { name: "Grant Microphone Access" })
		.click();
	await pressBrowserButton(permission, "Allow while visiting the site");
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
});

test("TC-14 (real prompt): dismissing it and then 'Never allow' each explain what to do, and closing the page reports the error", async ({
	extension,
}) => {
	const { context, fixture, panel, worker } = await extension({
		headed: true,
		micGranted: false,
		microphone: "prompt",
	});
	await fixture.getByLabel("Message").focus();
	const opened = nextPermissionPage(context);
	await clickRecord(panel);
	const permission = await opened;
	const grant = permission.getByRole("button", {
		name: "Grant Microphone Access",
	});
	const status = permission.getByRole("status");

	await grant.click();
	// Escape in the prompt closes it without an answer.
	await pressKeys(permission, "Escape", { focusButton: "Never allow" });
	await expect(status).toHaveText(
		"The prompt was closed. Click the button again and choose Allow while visiting the site.",
	);

	await grant.click();
	await pressBrowserButton(permission, "Never allow");
	await expect(status).toHaveText(BLOCKED_ON_PAGE);

	await permission.close();
	await expect(stateLabel(panel)).toHaveText("Error");
	await expect(panelError(panel)).toHaveText(
		"Microphone access was not granted. Click record to try again.",
	);
	expect(await storageGet(worker, "micGranted")).toBeUndefined();
});

test("TC-36 (real block): a stale grant asks for access again, and the permission page then reports the block", async ({
	extension,
}) => {
	// The stored grant says yes, but Chrome has never been asked for this profile.
	const { context, fixture, panel, worker } = await extension({
		headed: true,
		microphone: "prompt",
	});
	await fixture.getByLabel("Message").focus();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Error");
	await expect(panelError(panel)).toHaveText(NEEDS_ACCESS);
	await expect.poll(() => storageGet(worker, "micGranted")).toBeUndefined();

	const opened = nextPermissionPage(context);
	await fixture.bringToFront();
	await clickRecord(panel);
	const permission = await opened;
	await permission
		.getByRole("button", { name: "Grant Microphone Access" })
		.click();
	await pressBrowserButton(permission, "Never allow");
	await expect(permission.getByRole("status")).toHaveText(BLOCKED_ON_PAGE);
});

test("Real prompt: 'Allow this time' lasts while a Diduny page is open, then the next recording asks again, as the page warns", async ({
	extension,
}) => {
	const session = await extension({
		headed: true,
		micGranted: false,
		microphone: "prompt",
	});
	const { context, fixture, mock, openExtensionPage, panel, worker } = session;
	const message = fixture.getByLabel("Message");
	await message.focus();
	const opened = nextPermissionPage(context);
	await clickRecord(panel);
	const permission = await opened;
	await expect(
		permission.getByText(/Allow this time is not enough/),
	).toBeVisible();
	const closed = permission.waitForEvent("close");
	await permission
		.getByRole("button", { name: "Grant Microphone Access" })
		.click();
	await pressBrowserButton(permission, "Allow this time");
	await closed;

	// The one-time grant outlives the permission tab while the side panel stays open.
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect
		.poll(() => mock.realtimeFrames().some((frame) => frame.isBinary))
		.toBe(true);
	await fixture.bringToFront();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Done", { timeout: 30_000 });
	await expect(message).toHaveValue(/^Mock transcript \d+$/);

	// Once no Diduny page is open it is gone, though the stored grant still says yes.
	await panel.close();
	await expect
		.poll(() =>
			worker.evaluate(
				async () => (await chrome.runtime.getContexts({})).length,
			),
		)
		.toBe(1);
	const reopenedPanel = await openExtensionPage("sidepanel.html");
	await message.focus();
	await fixture.bringToFront();
	await clickRecord(reopenedPanel);
	await expect(stateLabel(reopenedPanel)).toHaveText("Error", {
		timeout: 15_000,
	});
	await expect(panelError(reopenedPanel)).toHaveText(NEEDS_ACCESS);
	await expect.poll(() => storageGet(worker, "micGranted")).toBeUndefined();
	const reopened = nextPermissionPage(context);
	await fixture.bringToFront();
	await clickRecord(reopenedPanel);
	await reopened;
});
