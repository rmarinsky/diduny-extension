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

test("translation dictation and pasted text use the explicit saved language pair", async () => {
	let rejectTranslation = false;
	let transcriptionBody = "";
	const upstream = Fastify();
	upstream.addContentTypeParser(
		/^multipart\/form-data/i,
		(_request, payload, done) => done(null, payload),
	);
	upstream.post("/api/v1/auth/send-otp", async () => ({}));
	upstream.post("/api/v1/auth/verify-otp", async () => ({
		accessToken: "translation-test-token",
		accessTokenExpiresAt: Date.now() + 300_000,
		refreshToken: "translation-test-refresh",
		user: { email: "translation@example.com" },
	}));
	upstream.post("/api/v1/transcriptions", async (request) => {
		for await (const chunk of request.body as AsyncIterable<Uint8Array>) {
			transcriptionBody += new TextDecoder().decode(chunk);
		}
		return { text: "Hello from translation dictation", tokens: [] };
	});
	upstream.get("/api/v1/translations", async (request, reply) => {
		if (rejectTranslation)
			return reply.code(402).send({ limitHours: 2, usedHours: 2 });
		const query = request.query as { q?: string; sl?: string; tl?: string };
		return { sentences: [{ trans: `${query.q} (${query.sl}->${query.tl})` }] };
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
		await page.goto(`${bffUrl}/`);
		await page.getByLabel("Email").fill("translation@example.com");
		await page.getByRole("button", { name: "Send one-time code" }).click();
		await page.getByLabel("One-time code").fill("123456");
		await page.getByRole("button", { name: "Sign in", exact: true }).click();
		await page.getByRole("button", { name: "Settings" }).click();
		await page.getByLabel("Translation source language").selectOption("uk");
		await page.getByLabel("Translation target language").selectOption("en");
		await page
			.getByRole("button", { name: "Save translation languages" })
			.click();
		await expect
			.poll(() => e2eLibrary.settings().translationSourceLanguage)
			.toBe("uk");
		await expect
			.poll(() => e2eLibrary.settings().translationTargetLanguage)
			.toBe("en");

		await page.getByRole("button", { name: "Dictation" }).click();
		await page.getByLabel("Translation dictation").check();
		await page.getByRole("button", { name: "Start dictation" }).click();
		await expect(page.locator(".meter-row output")).toHaveText("1s");
		await page.getByRole("button", { name: "Stop dictation" }).click();
		await expect(page.getByLabel("Dictation document")).toHaveValue(
			"Hello from translation dictation",
		);
		expect(transcriptionBody).toContain('"mode":"translate"');
		expect(transcriptionBody).toContain('"target_language":"en"');
		expect(transcriptionBody).toContain('"language_hints":["uk"]');

		await page.getByLabel("Text to translate").fill("Привіт");
		await page.getByRole("button", { name: "Translate pasted text" }).click();
		await expect(page.getByLabel("Translation result")).toHaveText(
			"Привіт (uk->en)",
		);
		rejectTranslation = true;
		await page.getByRole("button", { name: "Translate pasted text" }).click();
		await expect(
			page.getByText(
				"You are out of hours (2 of 2 used). Add hours or wait for your plan to renew, then try again.",
			),
		).toBeVisible();
	} finally {
		bff.server.closeAllConnections?.();
		upstream.server.closeAllConnections?.();
		await browser.close();
		await bff.close();
		await upstream.close();
	}
});
