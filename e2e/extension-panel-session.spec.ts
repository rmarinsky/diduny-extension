import {
	TEST_EMAIL,
	badgeText,
	clickRecord,
	dictate,
	expect,
	liveBox,
	offscreenOpen,
	panelError,
	recordButton,
	stateLabel,
	test,
} from "./support/extension-harness";
import { signIn } from "./support/web-workspace";

const SESSION_ENDED =
	"Your Diduny session has ended. Sign in again in the Diduny web app, then press 'I signed in'.";

test("TC-01: signing out on the web returns the panel to the sign-in view, and Record explains how to sign in again", async ({
	extension,
}) => {
	const session = await extension();
	const { context, fixture, panel, web } = session;
	const message = fixture.getByLabel("Message");
	await message.focus();

	await web.evaluate(() => fetch("/bff/auth/logout", { method: "POST" }));
	expect(
		await web.evaluate(() => fetch("/bff/auth/session").then((r) => r.json())),
	).toMatchObject({ authenticated: false });
	expect(
		await panel.evaluate(
			() =>
				new Promise((resolve) =>
					chrome.runtime.sendMessage({ type: "getBffSession" }, resolve),
				),
		),
	).toMatchObject({ authenticated: false });

	// BUG-E6: the panel kept the signed-in view and Record failed with a bare "Not authenticated".
	await fixture.bringToFront();
	await clickRecord(panel);
	await expect(panelError(panel)).toHaveText(SESSION_ENDED);
	await expect(
		panel.getByText("Sign in in the Diduny web app, then return here."),
	).toBeVisible();
	await expect(panel.getByText("Not authenticated")).toBeHidden();
	await expect(message).toHaveValue("");

	await panel.bringToFront();
	const signInTab = context.waitForEvent("page");
	await panel.getByRole("button", { name: "Open Diduny sign-in" }).click();
	const webSignIn = await signInTab;
	await webSignIn.waitForLoadState();
	await signIn(webSignIn);
	await panel.bringToFront();
	await panel.getByRole("button", { name: "I signed in" }).click();
	await expect(panel.getByText(TEST_EMAIL)).toBeVisible();
	await expect(recordButton(panel)).toBeEnabled();
});

test("TC-02: Logout during a recording stops it, and the next recording after signing in works", async ({
	extension,
}) => {
	const session = await extension();
	const { fixture, panel, web, worker } = session;
	const message = fixture.getByLabel("Message");
	await message.focus();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Recording...");
	await expect.poll(() => badgeText(worker)).toBe("●");

	// BUG-E2: the capture kept running and, after signing in again, Stop hung on Processing.
	await panel.bringToFront();
	await panel.getByRole("button", { name: "Logout" }).click();
	await expect(
		panel.getByRole("button", { name: "Open Diduny sign-in" }),
	).toBeVisible();
	await expect.poll(() => badgeText(worker)).toBe("");
	await expect.poll(() => offscreenOpen(worker)).toBe(false);
	await expect(message).toHaveValue("");

	await web.reload();
	await signIn(web);
	await panel.bringToFront();
	await panel.getByRole("button", { name: "I signed in" }).click();
	await expect(panel.getByText(TEST_EMAIL)).toBeVisible();
	await expect(stateLabel(panel)).toHaveText("Ready");
	await expect(liveBox(panel)).toBeHidden();
	await expect(recordButton(panel)).toBeEnabled();

	await message.focus();
	await dictate(session);
	await expect(message).toHaveValue(/^Mock transcript \d+$/);
	await expect.poll(() => badgeText(worker)).toBe("");
});

test("TC-05: the signed-out view opens sign-in and Settings, and 'I signed in' explains when no session is found", async ({
	extension,
}) => {
	const { bffUrl, context, panel } = await extension({ signedIn: false });
	await panel.bringToFront();
	await expect(panel.getByRole("heading", { name: "Diduny" })).toBeVisible();
	await expect(
		panel.getByText("Voice dictation & meeting recording"),
	).toBeVisible();
	await expect(
		panel.getByText("Sign in in the Diduny web app, then return here."),
	).toBeVisible();

	const settingsTab = context.waitForEvent("page");
	await panel.getByRole("button", { name: "BFF settings" }).click();
	expect((await settingsTab).url()).toContain("/options.html");

	// BUG-E13: the button flashed "Checking..." and said nothing.
	await panel.bringToFront();
	await panel.getByRole("button", { name: "I signed in" }).click();
	await expect(panelError(panel)).toHaveText(
		"No Diduny session found. Sign in in the Diduny web app first, then press 'I signed in'.",
	);

	const signInTab = context.waitForEvent("page");
	await panel.getByRole("button", { name: "Open Diduny sign-in" }).click();
	const webSignIn = await signInTab;
	await webSignIn.waitForLoadState();
	expect(new URL(webSignIn.url()).origin).toBe(bffUrl);
	await signIn(webSignIn);

	await panel.bringToFront();
	await panel.getByRole("button", { name: "I signed in" }).click();
	await expect(panel.getByText(TEST_EMAIL)).toBeVisible();
	for (const name of ["Settings", "Logs", "Logout", "Start recording"])
		await expect(
			panel.getByRole("button", { name, exact: true }),
		).toBeVisible();
	await expect(panelError(panel)).toBeHidden();
});
