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

test("onboarding asks for microphone access, explains delivery, and persists never-save after sign-in", async () => {
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
	await installSupportedBrowserCapabilities(context, {
		onboardingCompleted: false,
	});
	await installFakeMicrophones(context);
	const page = await context.newPage();

	try {
		await page.goto(`${bffUrl}/`);
		await expect(
			page.getByRole("heading", { name: "Use your microphone" }),
		).toBeVisible();
		await expectNoAxeViolations(page);
		await page.getByRole("button", { name: "Allow microphone" }).click();
		await expect(page.getByText("Microphone access is ready.")).toBeVisible();
		await page.getByRole("button", { name: "Continue" }).click();

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
		await page.getByRole("button", { name: "Continue" }).click();

		await expect(
			page.getByRole("heading", {
				name: "Which engine transcribes your voice",
			}),
		).toBeVisible();
		await expect(
			page.getByText("more accurate and handles accents", { exact: false }),
		).toBeVisible();
		await page.getByLabel("Never save recordings").check();
		await expect(
			page.getByText("audio is buffered in a temporary file", { exact: false }),
		).toBeVisible();
		await page.getByRole("button", { name: "Continue to sign in" }).click();
		await page.getByLabel("Email").fill("onboarding@example.com");
		await page.getByRole("button", { name: "Send one-time code" }).click();
		await page.getByLabel("One-time code").fill("123456");
		await page.getByRole("button", { name: "Sign in", exact: true }).click();
		await expect.poll(() => e2eLibrary.retention().dictation).toBe("never");

		const document = page.getByLabel("Dictation document");
		await document.fill("Keep this draft while reviewing delivery.");
		await page.getByRole("button", { name: "About delivery" }).click();
		await expect(
			page.getByRole("heading", { name: "Where your words end up" }),
		).toBeVisible();
		await expectNoAxeViolations(page);
		await page.getByRole("button", { name: "Close onboarding" }).click();
		await expect(
			page.getByRole("button", { name: "About delivery" }),
		).toBeFocused();
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
