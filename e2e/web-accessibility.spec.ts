import { AxeBuilder } from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import Fastify from "fastify";
import { chromium } from "playwright";
import { buildServer } from "../server";
import { installSupportedBrowserCapabilities } from "./support/browser-capabilities";
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

test("all web views pass axe and remain usable without horizontal scrolling at 200% zoom", async () => {
	const upstream = Fastify();
	upstream.post("/api/v1/auth/send-otp", async () => ({}));
	upstream.post("/api/v1/auth/verify-otp", async () => ({
		accessToken: "accessibility-token",
		accessTokenExpiresAt: Date.now() + 300_000,
		refreshToken: "accessibility-refresh",
		user: { email: "accessibility@example.com" },
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
	const context = await browser.newContext({
		viewport: { height: 900, width: 640 },
	});
	await installSupportedBrowserCapabilities(context);
	const page = await context.newPage();

	try {
		await page.goto(`${bffUrl}/`);
		await expectNoAxeViolations(page);
		await page.getByLabel("Email").fill("accessibility@example.com");
		await page.getByRole("button", { name: "Send one-time code" }).click();
		await page.getByLabel("One-time code").fill("123456");
		await page.getByRole("button", { name: "Sign in", exact: true }).click();

		await expectNoAxeViolations(page);
		expect(
			await page
				.locator("button, input:not([type=checkbox]), select")
				.evaluateAll((elements) =>
					elements.every(
						(element) => element.getBoundingClientRect().height >= 44,
					),
				),
		).toBe(true);
		await page.keyboard.press("Alt+Shift+P");
		await expectNoAxeViolations(page);
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "Library" }).click();
		await expectNoAxeViolations(page);
		await page.getByRole("button", { name: "Settings" }).click();
		await expectNoAxeViolations(page);

		await page.evaluate(() => {
			document.documentElement.style.zoom = "2";
		});
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
	} finally {
		bff.server.closeAllConnections?.();
		upstream.server.closeAllConnections?.();
		await browser.close();
		await bff.close();
		await upstream.close();
	}
});
