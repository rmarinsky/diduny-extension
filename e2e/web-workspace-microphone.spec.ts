import type { Page } from "@playwright/test";
import {
	dictate,
	dictationDocument,
	dictationStatus,
	expect,
	test,
} from "./support/web-workspace";

const blockedMessage =
	"Microphone access is blocked. Open this site’s settings in your browser, allow Microphone, then try again.";

function getUserMediaCalls(page: Page) {
	return page.evaluate(
		() =>
			(
				globalThis as typeof globalThis & {
					didunyMicrophone: { calls: unknown[] };
				}
			).didunyMicrophone.calls,
	);
}

function failMicrophoneWith(page: Page, name: string) {
	return page.evaluate((errorName) => {
		(
			globalThis as typeof globalThis & {
				didunyMicrophone: { failWith: string | null };
			}
		).didunyMicrophone.failWith = errorName;
	}, name);
}

test("TC-18: the chosen recording microphone is saved and dictation records with it", async ({
	workspace,
}) => {
	const { library, page } = await workspace({
		microphones: { permission: "granted" },
	});
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const microphone = page.getByRole("region", { name: "Microphone" });
	await microphone.getByLabel("Recording microphone").selectOption("usb");
	await expect(
		microphone.getByText("Microphone preference saved."),
	).toBeVisible();
	expect(library.settings().microphoneDeviceId).toBe("usb");

	await page.getByRole("button", { name: "Dictation", exact: true }).click();
	await dictate(page);
	await expect(dictationDocument(page)).toHaveValue("Mock transcript 1");
	expect(await getUserMediaCalls(page)).toContainEqual({
		audio: expect.objectContaining({ deviceId: { exact: "usb" } }),
	});
});

test("TC-19: a saved microphone that is gone falls back to an available one with a notice", async ({
	workspace,
}) => {
	const { page } = await workspace({
		microphones: {
			devices: [{ deviceId: "built-in", label: "Built-in Microphone" }],
			permission: "granted",
		},
		settings: { microphoneDeviceId: "usb" },
	});
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await expect(
		page.getByText(
			"Saved microphone is unavailable. The browser will use Built-in Microphone.",
		),
	).toBeVisible();

	await page.getByRole("button", { name: "Dictation", exact: true }).click();
	await page.getByRole("button", { name: "Start dictation" }).click();
	await expect(dictationStatus(page)).toHaveText(
		"Saved microphone is unavailable. Recording with Built-in Microphone.",
	);
	await expect(page.locator(".meter-row output")).toHaveText("1s");
	await page.getByRole("button", { name: "Stop dictation" }).click();
	await expect(dictationDocument(page)).toHaveValue("Mock transcript 1");
});

test("TC-20: a denied microphone says how to allow it and uploads nothing", async ({
	workspace,
}) => {
	const { mock, page } = await workspace({
		microphones: { permission: "denied" },
	});
	await page.getByRole("button", { name: "Start dictation" }).click();
	await expect(dictationStatus(page)).toHaveText(blockedMessage);
	await expect(
		page.getByRole("button", { name: "Start dictation" }),
	).toBeVisible();
	expect(mock.transcriptions()).toEqual([]);
	expect(mock.realtimeFrames()).toEqual([]);

	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await expect(
		page.getByText(
			"Microphone access is blocked. Open this site’s settings in your browser, allow Microphone, then return here and refresh.",
		),
	).toBeVisible();
});

test("TC-43: each microphone failure explains what to do", async ({
	workspace,
}) => {
	const { mock, page } = await workspace({
		microphones: { permission: "granted" },
	});
	const start = page.getByRole("button", { name: "Start dictation" });

	// BUG-W18: all three showed "Could not start the microphone."
	await failMicrophoneWith(page, "NotAllowedError");
	await start.click();
	await expect(dictationStatus(page)).toHaveText(blockedMessage);

	await failMicrophoneWith(page, "NotFoundError");
	await start.click();
	await expect(dictationStatus(page)).toHaveText(
		"No microphone was found. Connect a microphone, then try again.",
	);

	await failMicrophoneWith(page, "NotReadableError");
	await start.click();
	await expect(dictationStatus(page)).toHaveText(
		"The microphone is in use by another app or could not be opened. Close the other app, then try again.",
	);
	expect(mock.transcriptions()).toEqual([]);
});
