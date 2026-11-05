import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import Fastify from "fastify";
import { chromium } from "playwright";
import { buildServer } from "../server";
import {
	installFakeDictationCapture,
	installSupportedBrowserCapabilities,
} from "./support/browser-capabilities";
import { createE2eLibrary } from "./support/fake-library";

function serverUrl(server: ReturnType<typeof Fastify>) {
	const address = server.server.address();
	if (!address || typeof address === "string")
		throw new Error("Server did not bind a port");
	return `http://localhost:${address.port}`;
}

test("web dictation cancels safely, uses keyboard and hold controls, and relays only completed audio", async () => {
	let transcriptionRequests = 0;
	const upstream = Fastify();
	upstream.addContentTypeParser(
		/^multipart\/form-data/i,
		(_request, payload, done) => done(null, payload),
	);
	upstream.post("/api/v1/auth/send-otp", async () => ({}));
	upstream.post("/api/v1/auth/verify-otp", async () => ({
		accessToken: "web-test-token",
		accessTokenExpiresAt: Date.now() + 300_000,
		refreshToken: "web-test-refresh",
		user: { email: "dictation@example.com" },
	}));
	upstream.post("/api/v1/transcriptions", async () => {
		transcriptionRequests += 1;
		return { text: "Hello from web dictation", tokens: [] };
	});
	await upstream.listen({ host: "localhost", port: 0 });
	const e2eLibrary = createE2eLibrary();
	const bff = await buildServer({
		library: e2eLibrary.library,
		staticDir: fileURLToPath(new URL("../web/dist", import.meta.url)),
		upstreamUrl: serverUrl(upstream),
	});
	await bff.listen({ host: "localhost", port: 0 });
	const bffUrl = serverUrl(bff);
	const browser = await chromium.launch({
		channel: "chromium",
		headless: true,
	});
	const context = await browser.newContext();
	await installSupportedBrowserCapabilities(context);
	await installFakeDictationCapture(context);
	const page = await context.newPage();

	try {
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: bffUrl,
		});
		await page.goto(`${bffUrl}/`);
		await page.getByLabel("Email").fill("dictation@example.com");
		await page.getByRole("button", { name: "Send one-time code" }).click();
		await page.getByLabel("One-time code").fill("123456");
		await page.getByRole("button", { name: "Sign in", exact: true }).click();
		await page.getByRole("button", { name: "Settings" }).click();
		await page.getByLabel("Key", { exact: true }).press("Alt+Shift+M");
		await page.getByRole("button", { name: "Save shortcut" }).click();
		await expect(page.getByText("Shortcut saved: Alt+Shift+M.")).toBeVisible();
		await page.getByRole("button", { name: "Dictation" }).click();
		await expect(page.getByText("Shortcut: Alt + Shift + M")).toBeVisible();

		const document = page.getByLabel("Dictation document");
		await document.focus();
		await page.keyboard.press("Space");
		await expect(document).toHaveValue(" ");
		expect(transcriptionRequests).toBe(0);
		await document.fill("");

		// Alt chords type nothing, so the shortcut works with the cursor in the document.
		await document.focus();
		await page.keyboard.press("Alt+Shift+M");
		await expect(page.getByText("Listening…")).toBeVisible();
		await expect(document).toHaveValue("");
		await page.keyboard.press("Escape");
		await expect(page.getByText("Dictation cancelled.")).toBeVisible();
		expect(transcriptionRequests).toBe(0);
		expect(e2eLibrary.savedTexts()).toEqual([]);

		// With the extension installed, Chrome hands its Alt+Shift+V to the
		// extension, which forwards the press to this tab as a window event.
		await page.evaluate(() =>
			window.dispatchEvent(new Event("diduny:dictation-shortcut")),
		);
		await expect(page.getByText("Listening…")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByText("Dictation cancelled.")).toBeVisible();
		expect(transcriptionRequests).toBe(0);

		await page.getByRole("button", { name: "Start dictation" }).focus();
		await page.keyboard.press("Enter");
		await expect(page.getByText("Listening…")).toBeVisible();
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByText("Dictation cancelled.")).toBeVisible();
		expect(transcriptionRequests).toBe(0);
		expect(e2eLibrary.savedTexts()).toEqual([]);

		await page.getByRole("button", { name: "Start dictation" }).focus();
		await page.keyboard.press("Alt+Shift+M");
		await expect(page.getByText("Listening…")).toBeVisible();
		await expect(page.getByLabel("Microphone level")).toHaveAttribute(
			"aria-valuenow",
			/[1-9]/,
		);
		await expect(page.locator(".meter-row output")).toHaveText("1s");
		await page.keyboard.press("Enter");
		await expect(document).toHaveValue("Hello from web dictation");
		expect(transcriptionRequests).toBe(1);
		await expect
			.poll(() => e2eLibrary.savedTexts())
			.toEqual(["Hello from web dictation"]);
		expect(e2eLibrary.recordings()).toEqual([
			expect.objectContaining({
				media: expect.objectContaining({
					contentType: "audio/webm;codecs=opus",
				}),
			}),
		]);

		await page.evaluate(() => navigator.clipboard.writeText("Keep this text"));
		await expect(page.getByLabel("Microphone level")).toHaveAttribute(
			"aria-valuenow",
			"0",
		);
		const recordButton = page.getByRole("button", { name: "Hold to record" });
		const idleBox = await recordButton.boundingBox();
		await recordButton.hover();
		await page.mouse.down();
		await expect(page.getByText("Listening…")).toBeVisible();
		// While held, only the hold button shows, and it stays under the pointer.
		await expect(recordButton).toHaveAttribute("aria-pressed", "true");
		await expect(recordButton).toBeEnabled();
		expect(await recordButton.boundingBox()).toEqual(idleBox);
		for (const name of ["Stop dictation", "Cancel", "Copy"])
			await expect(page.getByRole("button", { name })).toBeHidden();
		await expect(page.getByLabel("Microphone level")).toHaveAttribute(
			"aria-valuenow",
			/[1-9]/,
		);
		await expect(page.locator(".meter-row output")).toHaveText("1s");
		await page.mouse.up();
		await expect(document).toHaveValue(
			"Hello from web dictation\n---\nHello from web dictation",
		);
		expect(transcriptionRequests).toBe(2);
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe("Keep this text");
		await page.getByRole("button", { name: "Copy" }).click();
		// Windows stores clipboard text with CRLF line endings.
		await expect
			.poll(async () =>
				(await page.evaluate(() => navigator.clipboard.readText())).replace(
					/\r\n/g,
					"\n",
				),
			)
			.toBe("Hello from web dictation\n---\nHello from web dictation");

		const clearButton = page.getByRole("button", { name: "Clear" });
		await clearButton.click();
		await expect(document).toHaveValue("");
		await expect(document).toBeFocused();
		await expect(page.getByText("Document cleared.")).toBeVisible();
		await expect(clearButton).toBeDisabled();
	} finally {
		bff.server.closeAllConnections?.();
		upstream.server.closeAllConnections?.();
		await browser.close();
		await bff.close();
		await upstream.close();
	}
});
