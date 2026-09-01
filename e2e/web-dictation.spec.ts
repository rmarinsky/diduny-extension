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
		staticDir: new URL("../web/dist", import.meta.url).pathname,
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
		await page.getByLabel("Toggle dictation").fill("Alt+Shift+M");
		await page.getByRole("button", { name: "Save shortcut" }).click();
		await expect(page.getByText("Shortcut saved: Alt+Shift+M.")).toBeVisible();
		await page.getByRole("button", { name: "Dictation" }).click();
		await expect(
			page.getByText("Shortcut: Alt+Shift+M outside text fields."),
		).toBeVisible();

		const document = page.getByLabel("Dictation document");
		await document.focus();
		await page.keyboard.press("Space");
		await expect(document).toHaveValue(" ");
		expect(transcriptionRequests).toBe(0);
		await document.fill("");

		await page.keyboard.press("Tab");
		await page.keyboard.press("Alt+Shift+M");
		await expect(page.getByText("Listening…")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByText("Dictation cancelled.")).toBeVisible();
		expect(transcriptionRequests).toBe(0);
		expect(e2eLibrary.savedTexts()).toEqual([]);

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

		await page.evaluate(() => navigator.clipboard.writeText("Keep this text"));
		await expect(page.getByLabel("Microphone level")).toHaveAttribute(
			"aria-valuenow",
			"0",
		);
		const recordButton = page.getByRole("button", { name: "Hold to record" });
		await recordButton.hover();
		await page.mouse.down();
		await expect(page.getByText("Listening…")).toBeVisible();
		await expect(page.getByLabel("Microphone level")).toHaveAttribute(
			"aria-valuenow",
			/[1-9]/,
		);
		await expect(page.locator(".meter-row output")).toHaveText("1s");
		await page.mouse.up();
		await expect(document).toHaveValue(
			"Hello from web dictation Hello from web dictation",
		);
		expect(transcriptionRequests).toBe(2);
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe("Keep this text");
		await page.getByRole("button", { name: "Copy" }).click();
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe("Hello from web dictation Hello from web dictation");
	} finally {
		bff.server.closeAllConnections?.();
		upstream.server.closeAllConnections?.();
		await browser.close();
		await bff.close();
		await upstream.close();
	}
});
