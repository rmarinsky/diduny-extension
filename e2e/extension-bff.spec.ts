import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import Fastify from "fastify";
import { chromium } from "playwright";
import { buildServer } from "../server";
import { buildMockProxy } from "../src/mock-proxy";
import { installSupportedBrowserCapabilities } from "./support/browser-capabilities";
import { createE2eLibrary } from "./support/fake-library";

function serverUrl(server: ReturnType<typeof Fastify>, hostname = "127.0.0.1") {
	const address = server.server.address();
	if (!address || typeof address === "string")
		throw new Error("Server did not bind a port");
	return `http://${hostname}:${address.port}`;
}

test("loaded extension signs in through the mock proxy BFF, delivers dictation, and saves it", async () => {
	const accessToken = "access-token-should-never-reach-page";
	const refreshToken = "refresh-token-should-never-reach-page";
	const tokenFragments = [accessToken, refreshToken];
	const mock = await buildMockProxy({ accessToken, refreshToken });
	const fixtureServer = Fastify();
	fixtureServer.get("/fixture", async (_request, reply) =>
		reply.type("text/html").send(`
			<!doctype html>
			<title>Diduny delivery fixture</title>
			<textarea id="target" aria-label="Dictation target"></textarea>
		`),
	);
	await mock.server.listen({ host: "localhost", port: 0 });
	await fixtureServer.listen({ host: "localhost", port: 0 });
	const upstreamUrl = serverUrl(mock.server, "localhost");
	const fixtureUrl = serverUrl(fixtureServer, "localhost");
	const e2eLibrary = createE2eLibrary();

	const bff = await buildServer({
		library: e2eLibrary.library,
		staticDir: resolve("web/dist"),
		upstreamUrl,
	});
	await bff.listen({ host: "localhost", port: 0 });
	const bffUrl = serverUrl(bff, "localhost");
	const userDataDir = await mkdtemp(join(tmpdir(), "diduny-extension-e2e-"));
	let context:
		| Awaited<ReturnType<typeof chromium.launchPersistentContext>>
		| undefined;

	try {
		const extensionPath = resolve(".output/chrome-mv3");
		context = await chromium.launchPersistentContext(userDataDir, {
			args: [
				`--disable-extensions-except=${extensionPath}`,
				`--load-extension=${extensionPath}`,
				"--use-fake-device-for-media-stream",
				"--use-fake-ui-for-media-stream",
				"--autoplay-policy=no-user-gesture-required",
			],
			channel: "chromium",
			headless: true,
		});
		await installSupportedBrowserCapabilities(context);
		const responseBodies: Array<{ body: string; url: string }> = [];
		const responseReads: Array<Promise<void>> = [];
		context.on("response", (response) => {
			if (!response.url().startsWith(bffUrl)) return;
			responseReads.push(
				response
					.text()
					.then((body) => {
						responseBodies.push({ body, url: response.url() });
					})
					.catch(() => undefined),
			);
		});
		const worker =
			context.serviceWorkers()[0] ??
			(await context.waitForEvent("serviceworker", { timeout: 10_000 }));
		const extensionId = new URL(worker.url()).host;

		const fixture = await context.newPage();
		await fixture.goto(`${fixtureUrl}/fixture`);
		await fixture.locator("#target").focus();

		const options = await context.newPage();
		await options.goto(`chrome-extension://${extensionId}/options.html`);
		await options.locator("#bff-origin").fill(bffUrl);
		await options.getByRole("button", { name: "Save" }).click();
		await expect(options.locator("output")).toContainText("Saved");

		const webLogin = await context.newPage();
		await webLogin.goto(`${bffUrl}/`);
		expect(
			await webLogin.evaluate(() => {
				const browser = globalThis as typeof globalThis & {
					SpeechRecognition?: unknown;
					webkitSpeechRecognition?: unknown;
					FileSystemFileHandle?: {
						prototype?: { createSyncAccessHandle?: unknown };
					};
				};
				const browserNavigator = navigator as Navigator & {
					storage?: { getDirectory?: unknown };
				};
				return {
					audioWorklet: typeof browser.AudioWorkletNode === "function",
					displayCaptureAudio:
						typeof navigator.mediaDevices?.getDisplayMedia === "function",
					onDeviceSpeechRecognition:
						typeof browser.SpeechRecognition === "function" ||
						typeof browser.webkitSpeechRecognition === "function",
					opfsSyncAccess:
						typeof browserNavigator.storage?.getDirectory === "function" &&
						typeof browser.FileSystemFileHandle?.prototype
							?.createSyncAccessHandle === "function",
				};
			}),
		).toEqual({
			audioWorklet: true,
			displayCaptureAudio: true,
			onDeviceSpeechRecognition: true,
			opfsSyncAccess: true,
		});
		await webLogin.getByLabel("Email").fill("person@example.com");
		await webLogin.getByRole("button", { name: "Send one-time code" }).click();
		await webLogin.getByLabel("One-time code").fill("123456");
		await webLogin
			.getByRole("button", { name: "Sign in", exact: true })
			.click();
		await expect(webLogin.getByText("person@example.com")).toBeVisible();
		expect((await context.cookies(bffUrl))[0]).toMatchObject({
			httpOnly: true,
		});

		const panel = await context.newPage();
		await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
		const refreshSession = panel.getByRole("button", { name: "I signed in" });
		if (await refreshSession.isVisible()) await refreshSession.click();
		await expect(panel.getByText("person@example.com")).toBeVisible();

		await fixture.bringToFront();
		await fixture.locator("#target").focus();
		await options.evaluate(
			() =>
				new Promise<void>((resolve) => {
					chrome.storage.local.set({ micGranted: true }, resolve);
				}),
		);
		await panel.evaluate(() => {
			chrome.runtime.sendMessage({
				diarization: false,
				language: "uk",
				mode: "voice",
				type: "start-recording",
			});
		});
		await expect(panel.getByText("Recording...")).toBeVisible();
		await panel.evaluate(() => {
			chrome.runtime.sendMessage({ type: "stop-recording" });
		});

		await expect(fixture.locator("#target")).toHaveValue("Mock transcript", {
			timeout: 30_000,
		});
		expect(mock.transcriptions()).toHaveLength(1);
		const [transcription] = mock.transcriptions();
		if (!transcription) throw new Error("Expected extension transcription");
		expect(transcription).toMatchObject({
			authorization: `Bearer ${accessToken}`,
		});
		expect(transcription.bytes).toBeGreaterThan(0);
		const configPart = transcription.body.slice(
			transcription.body.indexOf('name="config"'),
		);
		expect(configPart).toContain("Content-Type: text/plain");
		await expect
			.poll(() => e2eLibrary.savedTexts(), { timeout: 10_000 })
			.toEqual(["Mock transcript"]);
		await Promise.all(responseReads);
		const pageStorage = await webLogin.evaluate(() => ({
			cookie: document.cookie,
			localStorage: Object.entries(localStorage),
			sessionStorage: Object.entries(sessionStorage),
		}));
		for (const tokenFragment of tokenFragments) {
			expect(pageStorage.cookie, "document.cookie").not.toContain(
				tokenFragment,
			);
			expect(
				JSON.stringify(pageStorage.localStorage),
				"localStorage",
			).not.toContain(tokenFragment);
			expect(
				JSON.stringify(pageStorage.sessionStorage),
				"sessionStorage",
			).not.toContain(tokenFragment);
			for (const response of responseBodies) {
				expect(
					response.body,
					`response body from ${response.url}`,
				).not.toContain(tokenFragment);
			}
		}
	} finally {
		await context?.close();
		bff.server.closeAllConnections?.();
		mock.server.server.closeAllConnections?.();
		fixtureServer.server.closeAllConnections?.();
		await bff.close();
		await mock.server.close();
		await fixtureServer.close();
		await rm(userDataDir, { force: true, recursive: true });
	}
});
