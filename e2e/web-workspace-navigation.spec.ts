import type { Page } from "@playwright/test";
import {
	dictate,
	dictationDocument,
	dictationStatus,
	expect,
	realtimeConfigs,
	reloadWorkspace,
	signIn,
	test,
} from "./support/web-workspace";

const extensionCopy =
	"With the Diduny browser extension, your words go straight into the text field you are typing in on other pages";

async function expectShippedExtensionCopy(page: Page) {
	await expect(
		page.getByRole("heading", { name: "Where your words end up" }),
	).toBeVisible();
	await expect(page.locator("main")).not.toContainText(
		"coming in the next release",
	);
	await expect(page.locator("main")).toContainText(extensionCopy);
}

test("TC-28: the delivery copy describes the browser extension that ships now", async ({
	workspace,
}) => {
	const { page } = await workspace({
		onboardingCompleted: false,
		signIn: false,
	});
	// BUG-W6: it said the extension was "coming in the next release".
	await expectShippedExtensionCopy(page);

	const continueToSignIn = page.getByRole("button", {
		name: "Continue to sign in",
	});
	while (!(await continueToSignIn.isVisible()))
		await page.getByRole("button", { name: "Next" }).click();
	await continueToSignIn.click();
	await signIn(page);
	await page.getByRole("button", { name: "About delivery" }).click();
	await expectShippedExtensionCopy(page);
});

test("TC-30: browser Back stays in the app and the document text survives Back and a reload", async ({
	workspace,
}) => {
	const { bffUrl, page } = await workspace({
		retention: { dictation: "never" },
	});
	await dictationDocument(page).fill("draft before back");
	await page.getByRole("button", { name: "Library", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

	// BUG-W16: Back left the app (to about:blank) and the document was lost.
	await page.goBack();
	expect(page.url().startsWith(bffUrl)).toBe(true);
	await expect(dictationDocument(page)).toHaveValue("draft before back");
	await page.goForward();
	await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
	await page.goBack();
	await expect(dictationDocument(page)).toHaveValue("draft before back");

	await reloadWorkspace(page);
	await expect(dictationDocument(page)).toHaveValue("draft before back");
});

test("TC-42: 'Stay signed in' keeps the session; 'Sign out' ends it and focus moves to Email", async ({
	workspace,
}) => {
	const { page } = await workspace();
	const signOut = page.getByRole("button", { name: "Sign out" });
	const dialog = page.getByRole("dialog", { name: "Sign out of Diduny?" });

	await signOut.click();
	await expect(
		dialog.getByRole("button", { name: "Stay signed in" }),
	).toBeFocused();
	await dialog.getByRole("button", { name: "Stay signed in" }).click();
	await expect(dialog).toHaveCount(0);
	await expect(signOut).toBeFocused();
	expect(
		await page.evaluate(() =>
			fetch("/bff/auth/session")
				.then((response) => response.json())
				.then((session: { authenticated: boolean }) => session.authenticated),
		),
	).toBe(true);

	await signOut.click();
	await dialog.getByRole("button", { name: "Sign out" }).click();
	await expect(page.getByText("Signed out.")).toBeVisible();
	// BUG-W17: focus dropped to the page body.
	await expect(page.getByLabel("Email")).toBeFocused();
	await expect(page.getByRole("navigation", { name: "Workspace" })).toHaveCount(
		0,
	);
	expect(
		await page.evaluate(() =>
			fetch("/bff/library").then((response) => response.status),
		),
	).toBe(401);

	await signIn(page);
	await expect(dictationStatus(page)).toHaveText("Ready to dictate.");
});

test("TC-44: the title button, theme and spoken languages persist and settings sync between tabs", async ({
	workspace,
}) => {
	const { mock, newPage, page: tabA } = await workspace();

	await tabA.getByRole("button", { name: "Settings", exact: true }).click();
	await tabA.getByRole("button", { name: "Diduny", exact: true }).click();
	await expect(dictationDocument(tabA)).toBeVisible();

	const toDark = tabA.getByRole("button", { name: "Switch to dark theme" });
	if (await toDark.isVisible()) await toDark.click();
	await tabA.getByRole("button", { name: "Switch to light theme" }).click();
	await expect(tabA.locator("html")).toHaveAttribute("data-theme", "light");
	await reloadWorkspace(tabA);
	await expect(tabA.locator("html")).toHaveAttribute("data-theme", "light");
	await expect(toDark).toBeVisible();

	const tabB = await newPage();
	const english = (page: Page) =>
		page.getByRole("checkbox", { name: "English", exact: true });
	const ukrainian = (page: Page) =>
		page.getByRole("checkbox", { name: "Українська", exact: true });
	await english(tabB).check();
	await expect(english(tabA)).toBeChecked({ timeout: 1_000 });

	await tabA.bringToFront();
	await ukrainian(tabA).uncheck();
	await expect(ukrainian(tabB)).not.toBeChecked({ timeout: 1_000 });
	await dictate(tabA);
	await expect(dictationDocument(tabA)).toHaveValue("Mock transcript 1");
	expect(realtimeConfigs(mock).at(-1)).toMatchObject({
		language_hints: ["en"],
		language_hints_strict: true,
	});

	await english(tabA).uncheck();
	await dictate(tabA);
	await expect(dictationDocument(tabA)).toHaveValue(
		"Mock transcript 1\n---\nMock transcript 2",
	);
	expect(realtimeConfigs(mock).at(-1)).not.toHaveProperty("language_hints");
});
