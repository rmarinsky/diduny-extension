import {
	type CharterAction,
	NEW_USER,
	charterSeeds,
	walk,
} from "../support/charter";
import {
	type ExtensionSession,
	TEST_EMAIL,
	badgeText,
	clickRecord,
	dictate,
	expect,
	panelError,
	panelSignedIn,
	stateLabel,
	test,
} from "../support/extension-harness";
import { signIn } from "../support/web-workspace";

// Charter AC1 (extension): the side panel's sign-in state against the real
// session, as a Returning user signs in and out on the web, logs out in the
// panel, reopens it and records, and as the session expires mid-recording.
// Invariants: the session the BFF holds matches the model, the panel never
// records while signed out, a start without a session says how to sign in
// again, and the badge is clear whenever nothing records.

const SESSION_ENDED =
	"Your Diduny session has ended. Sign in again in the Diduny web app, then press 'I signed in'.";
const NO_SESSION =
	"No Diduny session found. Sign in in the Diduny web app first, then press 'I signed in'.";
const EXPIRED = "Your Diduny sign-in has expired. Sign in again, then retry.";

interface Model {
	/** Whether the BFF holds a session for this browser. */
	session: boolean;
	ext: ExtensionSession;
	/** What the panel should show: signed in, or the sign-in view. */
	view: "in" | "out";
}

function signedOutView(model: Model) {
	return model.ext.panel.getByRole("button", { name: "Open Diduny sign-in" });
}

async function serverSession(model: Model) {
	return (await model.ext.panel.evaluate(
		() =>
			new Promise((resolve) =>
				chrome.runtime.sendMessage({ type: "getBffSession" }, resolve),
			),
	)) as { authenticated: boolean };
}

const actions: CharterAction<Model>[] = [
	{
		enabled: (model) => model.session,
		name: "Sign out on the web",
		async run(model) {
			await model.ext.web.evaluate(() =>
				fetch("/bff/auth/logout", { method: "POST" }),
			);
			model.session = false;
		},
	},
	{
		enabled: (model) => !model.session,
		name: "Sign in on the web",
		async run(model) {
			await model.ext.web.reload();
			await signIn(model.ext.web);
			model.session = true;
		},
	},
	{
		enabled: (model) => model.view === "out",
		name: "Press 'I signed in'",
		async run(model) {
			const { panel } = model.ext;
			await panel.bringToFront();
			await panel.getByRole("button", { name: "I signed in" }).click();
			if (model.session) {
				await expect(panel.getByText(TEST_EMAIL)).toBeVisible();
				model.view = "in";
			} else await expect(panelError(panel)).toHaveText(NO_SESSION);
		},
	},
	{
		enabled: (model) => model.view === "in",
		name: "Log out in the panel",
		async run(model) {
			const { panel } = model.ext;
			await panel.bringToFront();
			const logout = panel.getByRole("button", { name: "Logout" });
			// Looking at the panel can already show that the web sign-out ended the session.
			await expect(logout.or(signedOutView(model))).toBeVisible();
			if (await logout.isVisible()) await logout.click();
			await expect(signedOutView(model)).toBeVisible();
			model.view = "out";
			model.session = false;
		},
	},
	{
		enabled: (model) => model.view === "in",
		name: "Record",
		weight: 2,
		async run(model) {
			const { fixture, panel } = model.ext;
			if (!(await recordButtonVisible(model))) {
				// The panel noticed the ended session when it was looked at.
				expect(model.session).toBe(false);
				model.view = "out";
				return;
			}
			if (model.session) {
				await fixture.getByLabel("Message").focus();
				await dictate(model.ext, { waitForAudio: false });
				return;
			}
			await fixture.bringToFront();
			await clickRecord(panel);
			await expect(panelError(panel)).toHaveText(SESSION_ENDED);
			await expect(signedOutView(model)).toBeVisible();
			model.view = "out";
		},
	},
	{
		enabled: (model) => model.view === "in" && model.session,
		name: "The session expires while recording",
		async run(model) {
			const { mock, panel } = model.ext;
			for (const path of [
				"/api/v1/realtime",
				"/api/v1/transcriptions",
				"/api/v1/auth/refresh",
			])
				mock.setBehavior(path, "unauthorized");
			try {
				await dictate(model.ext, { end: "Error", waitForAudio: false });
				await expect(panelError(panel)).toHaveText(EXPIRED);
			} finally {
				mock.clearBehaviors();
			}
			// The failed refresh ended the session; the panel learns it on its next action.
			model.session = false;
		},
	},
	{
		name: "Reopen the panel",
		async run(model) {
			await model.ext.panel.reload();
			model.view = model.session ? "in" : "out";
			if (model.session) await panelSignedIn(model.ext.panel);
		},
	},
];

async function recordButtonVisible(model: Model) {
	return model.ext.panel.locator(".record-btn").isVisible();
}

for (const seed of charterSeeds())
	test(`AC1 extension sign-in state, seed ${seed}`, async ({
		extension,
	}, testInfo) => {
		const ext = await extension();
		const model: Model = { ext, session: true, view: "in" };
		await walk({
			actions,
			async check(current) {
				const { panel, worker } = current.ext;
				expect((await serverSession(current)).authenticated).toBe(
					current.session,
				);
				if (current.view === "in")
					await expect(panel.getByText(TEST_EMAIL)).toBeVisible();
				else await expect(signedOutView(current)).toBeVisible();
				if (current.view === "in" && (await recordButtonVisible(current)))
					await expect(stateLabel(panel)).not.toHaveText(
						/Recording|Processing|Starting/,
					);
				await expect.poll(() => badgeText(worker)).toBe("");
			},
			model,
			persona: NEW_USER,
			seed,
			testInfo,
		});
	});
