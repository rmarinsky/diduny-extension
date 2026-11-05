import { fileURLToPath } from "node:url";
import { AxeBuilder } from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import Fastify from "fastify";
import { chromium } from "playwright";
import { buildServer } from "../server";
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

async function expectNoAxeViolations(page: Page) {
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa"])
		.analyze();
	expect(results.violations).toEqual([]);
}

test("start page explains delivery, keeps the microphone optional, and saves the settings checkboxes after sign-in", async () => {
	const upstream = Fastify();
	upstream.post("/api/v1/auth/send-otp", async () => ({}));
	upstream.post("/api/v1/auth/verify-otp", async () => ({
		accessToken: "onboarding-token",
		accessTokenExpiresAt: Date.now() + 300_000,
		refreshToken: "onboarding-refresh",
		user: { email: "onboarding@example.com" },
	}));
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
	await installSupportedBrowserCapabilities(context, {
		onboardingCompleted: false,
	});
	await installFakeMicrophones(context);
	const page = await context.newPage();

	try {
		await page.goto(`${bffUrl}/`);
		await expect(
			page.getByRole("heading", { name: "Where your words end up" }),
		).toBeVisible();
		await expect(
			page.getByText("A web page can't type into other applications", {
				exact: false,
			}),
		).toBeVisible();
		await expect(
			page.getByText("whatever you copied five minutes ago", {
				exact: false,
			}),
		).toBeVisible();
		await expect(page.getByText("Step 1 of 2")).toBeVisible();
		await expect(page.getByLabel("Never save recordings")).toHaveCount(0);
		await expect(page.getByLabel("Email")).toHaveCount(0);
		await expectNoAxeViolations(page);

		await page.getByRole("button", { name: "Next" }).click();
		await expect(page.getByText("Step 2 of 2")).toBeVisible();
		await expect(
			page.getByRole("heading", {
				name: "Which engine transcribes your voice",
			}),
		).toBeFocused();
		await expect(
			page.getByText("more accurate and handles accents", { exact: false }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Use your microphone" }),
		).toBeVisible();
		await expect(page.getByLabel("Enable filler-word cleanup")).toBeChecked();
		await expect(
			page.getByLabel("Announce final live transcript"),
		).not.toBeChecked();
		await expectNoAxeViolations(page);

		await page.getByRole("button", { name: "Back" }).click();
		await expect(
			page.getByRole("heading", { name: "Where your words end up" }),
		).toBeFocused();
		await page.getByRole("button", { name: "Next" }).click();

		await page.getByRole("button", { name: "Allow microphone" }).click();
		await expect(page.getByText("Microphone access is ready.")).toBeVisible();
		await page.getByLabel("Never save recordings").check();
		await expect(
			page.getByText("audio is buffered in a temporary file", { exact: false }),
		).toBeVisible();
		await page.getByLabel("Enable filler-word cleanup").uncheck();
		await page.getByLabel("Announce final live transcript").check();
		await expect(
			page.getByText("choose “Allow while visiting the site”", {
				exact: false,
			}),
		).toBeVisible();
		await page.getByRole("button", { name: "Continue to sign in" }).click();

		// Reopened from the sign-in screen, the flow keeps the choices and the microphone grant.
		await page.getByRole("button", { name: "About delivery" }).click();
		await page.getByRole("button", { name: "Next" }).click();
		await expect(page.getByLabel("Never save recordings")).toBeChecked();
		await expect(
			page.getByLabel("Enable filler-word cleanup"),
		).not.toBeChecked();
		await expect(
			page.getByLabel("Announce final live transcript"),
		).toBeChecked();
		await expect(page.getByText("Microphone access is ready.")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Allow microphone" }),
		).toBeDisabled();
		await page.getByRole("button", { name: "Continue to sign in" }).click();

		await page.getByLabel("Email").fill("onboarding@example.com");
		await page.getByRole("button", { name: "Send one-time code" }).click();
		await page.getByLabel("One-time code").fill("123456");
		await page.getByRole("button", { name: "Sign in", exact: true }).click();
		await expect.poll(() => e2eLibrary.retention().dictation).toBe("never");
		await expect
			.poll(() => e2eLibrary.settings().textCleanupEnabled)
			.toBe(false);
		await expect
			.poll(() => e2eLibrary.settings().announceLiveTranscript)
			.toBe(true);

		const document = page.getByLabel("Dictation document");
		await document.fill("Keep this draft while reviewing delivery.");
		const aboutDelivery = page.getByRole("button", { name: "About delivery" });
		await aboutDelivery.click();
		await expect(
			page.getByRole("heading", { name: "Where your words end up" }),
		).toBeFocused();
		await expect(aboutDelivery).toHaveAttribute("aria-current", "page");
		await expectNoAxeViolations(page);
		await page.getByRole("button", { name: "Next" }).click();

		// The checkboxes show the saved settings and save the moment they change.
		const neverSave = page.getByLabel("Never save recordings");
		const cleanup = page.getByLabel("Enable filler-word cleanup");
		await expect(neverSave).toBeChecked();
		await expect(cleanup).not.toBeChecked();
		await expect(
			page.getByRole("button", { name: "Continue to sign in" }),
		).toHaveCount(0);
		await neverSave.uncheck();
		await expect(page.getByText("Saved.")).toBeVisible();
		expect(e2eLibrary.retention().dictation).toBe("forever");
		await cleanup.check();
		await expect
			.poll(() => e2eLibrary.settings().textCleanupEnabled)
			.toBe(true);
		await expectNoAxeViolations(page);
		await page.getByRole("button", { name: "Back to dictation" }).click();
		await expect(aboutDelivery).toBeFocused();
		await expect(document).toHaveValue(
			"Keep this draft while reviewing delivery.",
		);
	} finally {
		bff.server.closeAllConnections?.();
		upstream.server.closeAllConnections?.();
		await browser.close();
		await bff.close();
		await upstream.close();
	}
});

test("start page does not require microphone access before sign-in", async () => {
	const bff = await buildServer({
		staticDir: fileURLToPath(new URL("../web/dist", import.meta.url)),
		upstreamUrl: "http://127.0.0.1:9",
	});
	await bff.listen({ host: "localhost", port: 0 });
	const browser = await chromium.launch({
		channel: "chromium",
		headless: true,
	});
	const context = await browser.newContext();
	await installSupportedBrowserCapabilities(context, {
		onboardingCompleted: false,
	});
	const page = await context.newPage();

	try {
		await page.goto(`${serverUrl(bff)}/`);
		await page.getByRole("button", { name: "Next" }).click();
		await page.getByRole("button", { name: "Continue to sign in" }).click();
		await expect(page.getByLabel("Email")).toBeVisible();
		await page.reload();
		await expect(page.getByLabel("Email")).toBeVisible();

		// The sign-in screen keeps the delivery info one click away.
		await page.getByRole("button", { name: "About delivery" }).click();
		await expect(page.getByText("Step 1 of 2")).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Where your words end up" }),
		).toBeVisible();
		await page.getByRole("button", { name: "Next" }).click();
		await page.getByRole("button", { name: "Continue to sign in" }).click();
		await expect(page.getByLabel("Email")).toBeVisible();
	} finally {
		bff.server.closeAllConnections?.();
		await browser.close();
		await bff.close();
	}
});
