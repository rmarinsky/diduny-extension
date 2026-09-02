import { expect, test } from "@playwright/test";
import Fastify from "fastify";
import { chromium } from "playwright";
import { buildServer } from "../server";
import type { LibraryDetail } from "../src/core/ports";
import { installSupportedBrowserCapabilities } from "./support/browser-capabilities";
import { createE2eLibrary } from "./support/fake-library";

function serverUrl(server: ReturnType<typeof Fastify>) {
	const address = server.server.address();
	if (!address || typeof address === "string")
		throw new Error("Server did not bind a port");
	return `http://localhost:${address.port}`;
}

test("the keyboard command palette searches the library, copies the displayed text, and restores focus", async () => {
	const recordingId = "deafbeef-0000-4000-8000-000000000001";
	const displayText = "[00:03] Speaker 2: The board approved the proposal.";
	const recording: LibraryDetail = {
		createdAt: 1_750_000_000_000,
		displayText,
		durationSeconds: 123,
		history: [
			{
				createdAt: 1_750_000_000_000,
				id: `${recordingId}:current`,
				kind: "cloud",
				provider: "fixture",
				text: "The board approved the proposal.",
			},
		],
		id: recordingId,
		media: {
			contentType: "audio/webm",
			fileName: `${recordingId}.webm`,
			fileSizeBytes: 11,
			id: recordingId,
		},
		status: "transcribed",
		text: "The board approved the proposal.",
		title: "Board decision",
		type: "voice",
	};
	const upstream = Fastify();
	upstream.post("/api/v1/auth/send-otp", async () => ({}));
	upstream.post("/api/v1/auth/verify-otp", async () => ({
		accessToken: "palette-token",
		accessTokenExpiresAt: Date.now() + 300_000,
		refreshToken: "palette-refresh",
		user: { email: "palette@example.com" },
	}));
	await upstream.listen({ host: "localhost", port: 0 });
	const e2eLibrary = createE2eLibrary([recording]);
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
	const page = await context.newPage();

	try {
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: bffUrl,
		});
		await page.goto(`${bffUrl}/`);
		await page.getByLabel("Email").fill("palette@example.com");
		await page.getByRole("button", { name: "Send one-time code" }).click();
		await page.getByLabel("One-time code").fill("123456");
		await page.getByRole("button", { name: "Sign in", exact: true }).click();

		const document = page.getByLabel("Dictation document");
		await document.focus();
		await page.keyboard.press("Alt+Shift+P");
		const palette = page.getByRole("dialog", { name: "Command palette" });
		await expect(palette).toBeVisible();
		await palette.getByLabel("Search recent transcripts").fill("board");
		await expect(
			palette.getByRole("button", { name: "Board decision" }),
		).toBeVisible();
		await page.keyboard.press("Enter");
		await expect(palette).toBeHidden();
		await expect(document).toBeFocused();
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe(displayText);

		await page.keyboard.press("Alt+Shift+P");
		await expect(palette).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(palette).toBeHidden();
		await expect(document).toBeFocused();
	} finally {
		bff.server.closeAllConnections?.();
		upstream.server.closeAllConnections?.();
		await browser.close();
		await bff.close();
		await upstream.close();
	}
});
