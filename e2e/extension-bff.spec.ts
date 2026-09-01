import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import Fastify from "fastify";
import { chromium } from "playwright";
import { buildServer } from "../server";

function serverUrl(server: ReturnType<typeof Fastify>, hostname = "127.0.0.1") {
	const address = server.server.address();
	if (!address || typeof address === "string")
		throw new Error("Server did not bind a port");
	return `http://${hostname}:${address.port}`;
}

test("loaded extension signs in through the BFF, triggers its backend relay, and delivers dictation", async () => {
	const upstream = Fastify();
	let transcriptionRequests = 0;
	let transcriptionBytes = 0;
	let upstreamAuthorization = "";
	upstream.addContentTypeParser(
		/^multipart\/form-data/i,
		(_request, payload, done) => {
			done(null, payload);
		},
	);
	upstream.get("/fixture", async (_request, reply) =>
		reply.type("text/html").send(`
			<!doctype html>
			<title>Diduny delivery fixture</title>
			<textarea id="target" aria-label="Dictation target"></textarea>
		`),
	);
	upstream.post("/api/v1/auth/verify-otp", async () =>
		JSON.stringify({
			accessToken: "test-server-token",
			accessTokenExpiresAt: Date.now() + 300_000,
			refreshToken: "test-server-refresh",
			user: { email: "person@example.com" },
		}),
	);
	upstream.post("/api/v1/auth/send-otp", async () => ({}));
	upstream.post("/api/v1/transcriptions", async (request) => {
		transcriptionRequests += 1;
		upstreamAuthorization = request.headers.authorization ?? "";
		for await (const chunk of request.body as AsyncIterable<Uint8Array>) {
			transcriptionBytes += chunk.byteLength;
		}
		return { text: "Hello from backend", tokens: [] };
	});
	await upstream.listen({ host: "localhost", port: 0 });
	const upstreamUrl = serverUrl(upstream, "localhost");

	const bff = await buildServer({
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
		const worker =
			context.serviceWorkers()[0] ??
			(await context.waitForEvent("serviceworker", { timeout: 10_000 }));
		const extensionId = new URL(worker.url()).host;

		const fixture = await context.newPage();
		await fixture.goto(`${upstreamUrl}/fixture`);
		await fixture.locator("#target").focus();

		const options = await context.newPage();
		await options.goto(`chrome-extension://${extensionId}/options.html`);
		await options.locator("#bff-origin").fill(bffUrl);
		await options.getByRole("button", { name: "Save" }).click();
		await expect(options.locator("output")).toContainText("Saved");

		const webLogin = await context.newPage();
		await webLogin.goto(`${bffUrl}/`);
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

		await expect(fixture.locator("#target")).toHaveValue("Hello from backend", {
			timeout: 30_000,
		});
		expect(transcriptionRequests).toBe(1);
		expect(transcriptionBytes).toBeGreaterThan(0);
		expect(upstreamAuthorization).toBe("Bearer test-server-token");
	} finally {
		await context?.close();
		bff.server.closeAllConnections?.();
		upstream.server.closeAllConnections?.();
		await bff.close();
		await upstream.close();
		await rm(userDataDir, { force: true, recursive: true });
	}
});
