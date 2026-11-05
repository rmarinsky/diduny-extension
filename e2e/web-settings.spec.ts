import { fileURLToPath } from "node:url";
import { AxeBuilder } from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import Fastify from "fastify";
import { chromium } from "playwright";
import { buildServer } from "../server";
import { DEFAULT_SETTINGS } from "../src/core/settings";
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

test("settings: word chips, shortcut toggles, typing speed, instant language switch, and a confirmed reset that keeps retention", async () => {
	const upstream = Fastify();
	upstream.post("/api/v1/auth/send-otp", async () => ({}));
	upstream.post("/api/v1/auth/verify-otp", async () => ({
		accessToken: "settings-token",
		accessTokenExpiresAt: Date.now() + 300_000,
		refreshToken: "settings-refresh",
		user: { email: "settings@example.com" },
	}));
	await upstream.listen({ host: "localhost", port: 0 });
	const e2eLibrary = createE2eLibrary();
	const bff = await buildServer({
		library: e2eLibrary.library,
		staticDir: fileURLToPath(new URL("../web/dist", import.meta.url)),
		upstreamUrl: serverUrl(upstream),
	});
	await bff.listen({ host: "localhost", port: 0 });
	const browser = await chromium.launch({
		channel: "chromium",
		headless: true,
	});
	const context = await browser.newContext();
	await installSupportedBrowserCapabilities(context);
	const page = await context.newPage();

	try {
		await page.goto(`${serverUrl(bff)}/`);
		await page.getByLabel("Email").fill("settings@example.com");
		await page.getByRole("button", { name: "Send one-time code" }).click();
		await page.getByLabel("One-time code").fill("123456");
		await page.getByRole("button", { name: "Sign in", exact: true }).click();
		await page.getByRole("checkbox", { name: "English" }).check();
		await expect
			.poll(() => e2eLibrary.settings().speechLanguageHints)
			.toEqual(["uk", "en"]);
		await page.getByRole("button", { name: "Settings" }).click();

		const fillers = page.getByRole("textbox", {
			name: "Filler words to remove",
		});
		const fillerChips = page.getByRole("list", {
			name: "Filler words to remove",
		});
		await expect(fillerChips.getByRole("listitem")).toHaveText([/^um/, /^uh/]);
		await fillers.fill("like, you know");
		await fillers.press("Enter");
		await page.getByRole("button", { name: "Remove uh" }).click();
		await expect(fillerChips.getByRole("listitem")).toHaveText([
			/^um/,
			/^like/,
			/^you know/,
		]);
		const keep = page.getByRole("textbox", { name: "Phrases to keep" });
		await keep.fill("feel like");
		await keep.press("Enter");
		await page.getByRole("button", { name: "Save cleanup" }).click();
		await expect
			.poll(() => e2eLibrary.settings().fillerWords)
			.toEqual(["um", "like", "you know"]);
		expect(e2eLibrary.settings().protectedLexicon).toEqual(["feel like"]);
		await expectNoAxeViolations(page);

		await page.getByLabel("Key", { exact: true }).press("Alt+Shift+K");
		await expect(page.getByText("Preview: Alt + Shift + K")).toBeVisible();
		await expect(
			page.getByRole("button", { exact: true, name: "Alt" }),
		).toHaveAttribute("aria-pressed", "true");
		await page.getByRole("button", { name: "Save shortcut" }).click();
		await expect
			.poll(() => e2eLibrary.settings().dictationShortcut)
			.toBe("Alt+Shift+K");

		await page.getByLabel("Your typing speed, words per minute").fill("65");
		await page.getByRole("button", { name: "Save typing speed" }).click();
		await expect
			.poll(() => e2eLibrary.settings().typingSpeedWordsPerMinute)
			.toBe(65);
		await expect(page.getByText("Start typing test")).toHaveCount(0);

		// The typing test times from the first key to the last; a paste takes no time.
		const typingTest = page.getByRole("textbox", { name: "Typing test" });
		const saveMeasured = page.getByRole("button", {
			name: "Save measured speed",
		});
		await expect(saveMeasured).toBeDisabled();
		await typingTest.fill(
			"Clear ideas deserve calm words and careful attention.",
		);
		await saveMeasured.click();
		await expect(
			page.getByText("Type the sentence before saving your measured speed."),
		).toBeVisible();
		await typingTest.fill("");
		await typingTest.pressSequentially(
			"Clear ideas deserve calm words and careful attention.",
			{ delay: 60 },
		);
		await saveMeasured.click();
		await expect(
			page.getByText(/^Measured \d+ words per minute/),
		).toBeVisible();
		await expect
			.poll(() => e2eLibrary.settings().typingSpeedWordsPerMinute)
			.not.toBe(65);
		const measured = e2eLibrary.settings().typingSpeedWordsPerMinute ?? 0;
		expect(measured).toBeGreaterThan(0);
		expect(measured).toBeLessThanOrEqual(300);
		await expect(
			page.getByLabel("Your typing speed, words per minute"),
		).toHaveValue(String(measured));
		await expect(typingTest).toHaveValue("");

		await expect(page.getByText("Diduny uses", { exact: false })).toBeVisible();
		await expect(page.getByText("free on this filesystem")).toHaveCount(0);
		await expect(page.getByText("Data directory")).toHaveCount(0);

		await page.getByLabel("Dictation and translation").selectOption("never");
		await expect.poll(() => e2eLibrary.retention().dictation).toBe("never");

		await page
			.getByRole("combobox", { name: "Interface language" })
			.selectOption("uk");
		await page.getByRole("button", { name: "Save interface language" }).click();
		await expect(
			page.getByRole("button", { name: "Диктування" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Доступність" }),
		).toBeVisible();
		await expect(page.getByText("Мову інтерфейсу збережено.")).toBeVisible();

		const reset = page.getByRole("button", { name: "Скинути налаштування" });
		const dialog = page.getByRole("dialog", { name: "Скинути налаштування?" });
		await reset.click();
		await dialog.getByRole("button", { name: "Скасувати" }).click();
		await expect(dialog).toHaveCount(0);
		expect(e2eLibrary.settings().uiLocale).toBe("uk");

		await reset.click();
		await dialog.getByRole("button", { name: "Скинути налаштування" }).click();
		await expect(page.getByRole("button", { name: "Dictation" })).toBeVisible();
		await expect(page.getByText("Settings reset to defaults.")).toBeVisible();
		const restored = e2eLibrary.settings();
		expect(restored.fillerWords).toEqual(DEFAULT_SETTINGS.fillerWords);
		expect(restored.protectedLexicon).toEqual([]);
		expect(restored.dictationShortcut).toBe("Alt+Shift+V");
		expect(restored.speechLanguageHints).toEqual(["uk"]);
		expect(restored.typingSpeedWordsPerMinute).toBeNull();
		expect(e2eLibrary.retention().dictation).toBe("never");
		await expect(
			page.getByLabel("Your typing speed, words per minute"),
		).toHaveValue("40");
	} finally {
		bff.server.closeAllConnections?.();
		upstream.server.closeAllConnections?.();
		await browser.close();
		await bff.close();
		await upstream.close();
	}
});
