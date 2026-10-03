import { osInputAvailable, pressBrowserButton } from "../support/os-input";
import {
	dictationDocument,
	dictationStatus,
	expect,
	signIn,
	test,
} from "../support/web-workspace";

// Chrome's real microphone prompt for the web app, answered with UI Automation.
test.skip(!osInputAvailable, "Real OS input needs Windows");

test("Web (real prompt): 'Allow while visiting the site' lets the first dictation record", async ({
	workspace,
}) => {
	const { page } = await workspace({
		capture: "real",
		headed: true,
		microphonePrompt: true,
	});
	await page.getByRole("button", { name: "Start dictation" }).click();
	await pressBrowserButton(page, "Allow while visiting the site");
	await expect(dictationStatus(page)).toHaveText("Listening…");
	await page.waitForTimeout(1_500);
	await page.getByRole("button", { name: "Stop dictation" }).click();
	await expect(dictationDocument(page)).toHaveValue(/^Mock transcript \d+$/, {
		timeout: 30_000,
	});
});

test("Web (real prompt): 'Never allow' explains how to unblock the microphone (BUG-W18)", async ({
	workspace,
}) => {
	const { mock, page } = await workspace({
		capture: "real",
		headed: true,
		microphonePrompt: true,
	});
	await page.getByRole("button", { name: "Start dictation" }).click();
	await pressBrowserButton(page, "Never allow");
	await expect(dictationStatus(page)).toHaveText(
		"Microphone access is blocked. Open this site’s settings in your browser, allow Microphone, then try again.",
	);
	await expect(dictationDocument(page)).toHaveValue("");
	expect(mock.transcriptions()).toHaveLength(0);
});

test("Web (real prompt): the onboarding microphone step reports Chrome's answer", async ({
	workspace,
}) => {
	for (const [answer, outcome] of [
		["Allow while visiting the site", "Microphone access is ready."],
		[
			"Never allow",
			"Microphone access is blocked. Allow it in your browser settings, then try again.",
		],
	] as const) {
		const { page } = await workspace({
			capture: "real",
			headed: true,
			microphonePrompt: true,
			onboardingCompleted: false,
			signIn: false,
		});
		await page.getByRole("button", { name: "Next" }).click();
		await page.getByRole("button", { name: "Allow microphone" }).click();
		await pressBrowserButton(page, answer);
		await expect(page.getByText(outcome)).toBeVisible();
		await page.getByRole("button", { name: "Continue to sign in" }).click();
		await signIn(page);
		await page.close();
	}
});
