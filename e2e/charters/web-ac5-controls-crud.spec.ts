import type { Locator, Page } from "@playwright/test";
import {
	type Workspace,
	type WorkspaceOptions,
	dictationDocument,
	expect,
	test,
} from "../support/web-workspace";
import { seededRecording } from "../support/workspace-library";

// Charter AC5 (web): every control that asks before it destroys something,
// answered every way, including a Speedrunner's double click. Invariants: the
// change happens exactly once or not at all, and when nothing changes focus
// returns to the control that asked.

type Answer =
	| "confirm"
	| "cancel"
	| "Escape"
	| "click outside"
	| "double confirm";
const ANSWERS: Answer[] = [
	"confirm",
	"cancel",
	"Escape",
	"click outside",
	"double confirm",
];

/** Counts the page's requests matching a method and path. */
function countRequests(page: Page, method: string, path: RegExp) {
	let count = 0;
	page.on("request", (request) => {
		if (
			request.method() === method &&
			path.test(new URL(request.url()).pathname)
		)
			count += 1;
	});
	return () => count;
}

interface Control {
	name: string;
	/** Opens the confirmation and returns the control that opened it. */
	ask(page: Page): Promise<Locator>;
	confirm(page: Page): Locator;
	cancel(page: Page): Locator;
	options?: WorkspaceOptions;
	request: [string, RegExp];
	changed(workspace: Workspace, page: Page): Promise<boolean>;
}

const recordingId = "c0ffee00-0000-4000-8000-000000000501";

const CONTROLS: Control[] = [
	{
		name: "Library delete",
		options: {
			recordings: [seededRecording({ id: recordingId, text: "Keep me" })],
		},
		async ask(page) {
			await page.getByRole("button", { name: "Library", exact: true }).click();
			await page
				.getByRole("list", { name: "Library recordings" })
				.getByRole("button")
				.first()
				.click();
			const trigger = page.getByRole("button", {
				exact: true,
				name: "Delete recording",
			});
			await trigger.click();
			return trigger;
		},
		confirm: (page) => page.getByRole("button", { name: "Delete permanently" }),
		cancel: (page) => page.getByRole("button", { name: "Cancel delete" }),
		request: ["DELETE", /^\/bff\/library\//],
		async changed(workspace) {
			return workspace.library.recordings().length === 0;
		},
	},
	{
		name: "Reset settings",
		options: { settings: { dictationShortcut: "Alt+V" } },
		async ask(page) {
			await page.getByRole("button", { name: "Settings", exact: true }).click();
			const trigger = page.getByRole("button", { name: "Reset settings" });
			await trigger.click();
			return trigger;
		},
		confirm: (page) =>
			page
				.getByRole("dialog", { name: "Reset settings?" })
				.getByRole("button", { name: "Reset settings" }),
		cancel: (page) =>
			page
				.getByRole("dialog", { name: "Reset settings?" })
				.getByRole("button", { name: "Cancel" }),
		request: ["PATCH", /^\/bff\/settings$/],
		async changed(workspace) {
			return workspace.library.settings().dictationShortcut === "Alt+Shift+V";
		},
	},
	{
		name: "Sign out",
		async ask(page) {
			const trigger = page.getByRole("button", { name: "Sign out" });
			await trigger.click();
			return trigger;
		},
		confirm: (page) =>
			page
				.getByRole("dialog", { name: "Sign out of Diduny?" })
				.getByRole("button", { name: "Sign out" }),
		cancel: (page) =>
			page
				.getByRole("dialog", { name: "Sign out of Diduny?" })
				.getByRole("button", { name: "Stay signed in" }),
		request: ["POST", /^\/bff\/auth\/logout$/],
		async changed(_workspace, page) {
			return page.getByLabel("Email").isVisible();
		},
	},
];

for (const control of CONTROLS)
	for (const answer of ANSWERS)
		test(`AC5 web: ${control.name}, answered with ${answer}, changes once or not at all`, async ({
			workspace,
		}) => {
			const started = await workspace(control.options ?? {});
			const { page } = started;
			const requests = countRequests(page, ...control.request);
			const trigger = await control.ask(page);
			await expect(control.confirm(page)).toBeVisible();

			if (answer === "confirm") await control.confirm(page).click();
			if (answer === "double confirm") await control.confirm(page).dblclick();
			if (answer === "cancel") await control.cancel(page).click();
			if (answer === "Escape") await page.keyboard.press("Escape");
			if (answer === "click outside") await page.mouse.click(4, 4);
			await page.waitForTimeout(750);

			const changes = answer === "confirm" || answer === "double confirm";
			await expect.poll(() => control.changed(started, page)).toBe(changes);
			// A confirm sends exactly one request, even when double-clicked.
			expect(requests()).toBe(changes ? 1 : 0);
			if (answer === "cancel" || answer === "Escape") {
				await expect(control.confirm(page)).toBeHidden();
				await expect(trigger).toBeFocused();
			}
		});

test("AC5 web: Clear, then Ctrl+Z, restores the document; a Speedrunner's double click clears once", async ({
	workspace,
}) => {
	const { page } = await workspace();
	const document = dictationDocument(page);
	const clear = page.getByRole("button", { name: "Clear" });
	for (const clicks of [1, 2]) {
		await document.fill("Keep this text");
		if (clicks === 2) await clear.dblclick();
		else await clear.click();
		await expect(document).toHaveValue("");
		await expect(clear).toBeDisabled();
		await document.focus();
		await page.keyboard.press("Control+Z");
		await expect(document).toHaveValue("Keep this text");
	}
});
