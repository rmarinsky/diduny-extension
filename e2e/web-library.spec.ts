import { expect, test } from "@playwright/test";
import Fastify from "fastify";
import { chromium } from "playwright";
import { buildServer } from "../server";
import type { LibraryDetail } from "../src/core/ports";
import {
	installFakeMicrophones,
	installSupportedBrowserCapabilities,
} from "./support/browser-capabilities";
import { createE2eLibrary } from "./support/fake-library";

function serverUrl(server: ReturnType<typeof Fastify>) {
	const address = server.server.address();
	if (!address || typeof address === "string")
		throw new Error("Server did not bind a port");
	return `http://localhost:${address.port}`;
}

test("the web library searches server-side and edits, copies, plays, and deletes a recording", async () => {
	const recordingId = "deafbeef-0000-4000-8000-000000000001";
	const displayText = "[00:03] Speaker 2: The board approved the proposal.";
	const recording: LibraryDetail = {
		createdAt: 1_750_000_000_000,
		description: "Review this before Friday.",
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
			{
				createdAt: 1_749_999_000_000,
				id: `${recordingId}:previous`,
				kind: "local",
				provider: "fixture",
				text: "The board discussed the proposal.",
			},
		],
		id: recordingId,
		media: {
			contentType: "audio/webm",
			fileName: `${recordingId}.webm`,
			fileSizeBytes: 11,
			id: recordingId,
		},
		status: "partiallyRecovered",
		text: "The board approved the proposal.",
		title: "Board meeting",
		type: "meeting",
	};
	const upstream = Fastify();
	upstream.post("/api/v1/auth/send-otp", async () => ({}));
	upstream.post("/api/v1/auth/verify-otp", async () => ({
		accessToken: "test-server-token",
		accessTokenExpiresAt: Date.now() + 300_000,
		refreshToken: "test-server-refresh",
		user: { email: "reader@example.com" },
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
	await installFakeMicrophones(context);
	const page = await context.newPage();

	try {
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: bffUrl,
		});
		await page.goto(`${bffUrl}/`);
		await page.getByLabel("Email").fill("reader@example.com");
		await page.getByRole("button", { name: "Send one-time code" }).click();
		await page.getByLabel("One-time code").fill("123456");
		await page.getByRole("button", { name: "Sign in", exact: true }).click();

		await page.getByRole("button", { name: "Library" }).click();
		await page.getByLabel("Search library").fill("board");
		await page.getByRole("button", { name: "Search" }).click();
		await page.getByRole("button", { name: "Board meeting" }).click();

		await expect(page.getByLabel("Recording playback")).toHaveAttribute(
			"src",
			`/bff/library/${recordingId}/media`,
		);
		await expect(page.getByLabel("Transcript", { exact: true })).toHaveText(
			displayText,
		);
		await expect(page.getByText("Current version")).toBeVisible();
		await expect(
			page.getByText("The board discussed the proposal."),
		).toBeVisible();
		await expect(page.getByText("Recovered recording")).toBeVisible();

		await page.getByRole("button", { name: "Copy transcript" }).click();
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe(displayText);

		await page.getByLabel("Title").fill("Unsaved local title");
		const remoteLibraryPage = await context.newPage();
		await remoteLibraryPage.goto(`${bffUrl}/`);
		await remoteLibraryPage.getByRole("button", { name: "Library" }).click();
		await remoteLibraryPage
			.getByRole("button", { name: "Board meeting" })
			.click();
		await remoteLibraryPage.getByLabel("Title").fill("Remote board decision");
		await remoteLibraryPage
			.getByRole("button", { name: "Save details" })
			.click();
		await expect(
			page.getByRole("heading", { name: "Remote board decision" }),
		).toBeVisible();
		await expect(page.getByLabel("Title")).toHaveValue("Unsaved local title");

		await page.getByLabel("Title").fill("Final board decision");
		await page
			.getByLabel("Description")
			.fill("The decision to send to the team.");
		await page.getByRole("button", { name: "Save details" }).click();
		await expect(page.getByText("Details saved.")).toBeVisible();
		await page.getByRole("button", { name: "Back to library" }).click();
		await expect(
			page.getByRole("button", { name: "Final board decision" }),
		).toBeVisible();

		await page.getByRole("button", { name: "Final board decision" }).click();
		await page.getByRole("button", { name: "Delete recording" }).click();
		await page.getByRole("button", { name: "Delete permanently" }).click();
		await expect(
			page.getByText("No recordings match your search."),
		).toBeVisible();

		await page.getByRole("button", { name: "Settings" }).click();
		await expect(page.getByText("Storage on this device")).toBeVisible();
		await expect(
			page.getByText(
				"Microphone permission is required before devices can be named.",
			),
		).toBeVisible();
		await page.getByRole("button", { name: "Allow microphone" }).click();
		await page.getByLabel("Recording microphone").selectOption("usb");
		await expect
			.poll(() => e2eLibrary.settings().microphoneDeviceId)
			.toBe("usb");
		await page.evaluate(() => {
			(
				globalThis as typeof globalThis & {
					setDidunyMicrophonePermission(
						value: "denied" | "granted" | "prompt",
					): void;
				}
			).setDidunyMicrophonePermission("denied");
		});
		await page
			.getByRole("button", { name: "Refresh microphone devices" })
			.click();
		await expect(
			page.getByText("Microphone access is blocked. Open this site’s settings"),
		).toBeVisible();
		await page.getByLabel("Toggle dictation").fill("Alt+Shift+M");
		await page.getByRole("button", { name: "Save shortcut" }).click();
		await expect
			.poll(() => e2eLibrary.settings().dictationShortcut)
			.toBe("Alt+Shift+M");
		await page.getByRole("button", { name: "Dictation" }).click();
		await expect(
			page.getByText("Shortcut: Alt+Shift+M outside text fields."),
		).toBeVisible();
		await page.getByRole("button", { name: "Settings" }).click();
		await page.getByLabel("Toggle dictation").fill("Ctrl+R");
		await page.getByRole("button", { name: "Save shortcut" }).click();
		await expect(
			page.getByText("Ctrl+R is reserved by this browser and cannot be used."),
		).toBeVisible();
		const secondPage = await context.newPage();
		await secondPage.goto(`${bffUrl}/`);
		await secondPage.getByRole("button", { name: "Settings" }).click();
		await expect(
			secondPage.getByLabel("Enable filler-word cleanup"),
		).toBeChecked();
		await page.getByLabel("Enable filler-word cleanup").uncheck();
		await page.getByRole("button", { name: "Save cleanup" }).click();
		await expect
			.poll(() => e2eLibrary.settings().textCleanupEnabled)
			.toBe(false);
		await expect(
			secondPage.getByLabel("Enable filler-word cleanup"),
		).not.toBeChecked();
	} finally {
		bff.server.closeAllConnections?.();
		upstream.server.closeAllConnections?.();
		await browser.close();
		await bff.close();
		await upstream.close();
	}
});
