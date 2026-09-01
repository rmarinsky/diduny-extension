import websocket from "@fastify/websocket";
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

test("web dictation streams PCM through the BFF and delivers the realtime transcript", async () => {
	let transcriptionRequests = 0;
	const configFrames: Record<string, unknown>[] = [];
	let activeUpstreamSockets = 0;
	let pcmFrames = 0;
	const upstream = Fastify();
	await upstream.register(websocket);
	upstream.get("/api/v1/usage/me", async () => ({ remaining_seconds: 60 }));
	upstream.post("/api/v1/auth/send-otp", async () => ({}));
	upstream.post("/api/v1/auth/verify-otp", async () => ({
		accessToken: "web-realtime-token",
		accessTokenExpiresAt: Date.now() + 300_000,
		refreshToken: "web-realtime-refresh",
		user: { email: "realtime@example.com" },
	}));
	upstream.post("/api/v1/transcriptions", async () => {
		transcriptionRequests += 1;
		return { text: "HTTP fallback should not run", tokens: [] };
	});
	upstream.get("/api/v1/realtime", { websocket: true }, (socket) => {
		activeUpstreamSockets += 1;
		socket.on("close", () => {
			activeUpstreamSockets -= 1;
		});
		socket.send('{"type":"proxy_ready"}');
		let sentLiveTokens = false;
		socket.on("message", (data, isBinary) => {
			if (!isBinary) {
				const message = JSON.parse(String(data));
				if (message.type === "finalize") return;
				configFrames.push(message);
				return;
			}
			const byteLength = Array.isArray(data)
				? data.reduce((total, frame) => total + frame.byteLength, 0)
				: data.byteLength;
			if (byteLength === 0) {
				socket.send(
					'{"tokens":[{"text":"from realtime","is_final":true}],"finished":true}',
				);
				return;
			}
			pcmFrames += 1;
			if (!sentLiveTokens) {
				sentLiveTokens = true;
				socket.send(
					'{"tokens":[{"text":"Hello ","is_final":true},{"text":"from realtime","is_final":false}]}',
				);
			}
		});
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
		await page.getByLabel("Email").fill("realtime@example.com");
		await page.getByRole("button", { name: "Send one-time code" }).click();
		await page.getByLabel("One-time code").fill("123456");
		await page.getByRole("button", { name: "Sign in", exact: true }).click();

		await page.getByRole("button", { name: "Start dictation" }).click();
		const livePanel = page.locator("section[aria-label='Live transcript']");
		await expect(livePanel).toHaveAttribute("aria-hidden", "true");
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByText("Dictation cancelled.")).toBeVisible();
		await expect.poll(() => activeUpstreamSockets).toBe(0);
		await page.getByRole("button", { name: "Settings" }).click();
		await page.getByLabel("Announce final live transcript").check();
		await page
			.getByRole("button", { name: "Save accessibility settings" })
			.click();
		await page.getByRole("button", { name: "Dictation" }).click();
		await page.getByRole("button", { name: "Start dictation" }).click();
		await expect.poll(() => pcmFrames).toBeGreaterThan(0);
		await expect(livePanel).not.toHaveAttribute("aria-hidden", "true");
		await expect(livePanel.locator("p").first()).toHaveAttribute(
			"aria-live",
			"polite",
		);
		await expect(page.getByTestId("live-final-text")).toHaveText("Hello ");
		await expect(page.getByTestId("live-provisional-text")).toHaveText(
			"from realtime",
		);
		await page.getByRole("button", { name: "Stop dictation" }).click();

		await expect(page.getByLabel("Dictation document")).toHaveValue(
			"Hello from realtime",
		);
		await expect(page.getByLabel("Dictation document")).toBeFocused();
		expect(transcriptionRequests).toBe(0);
		expect(configFrames.at(-1)).toEqual(
			expect.objectContaining({
				audio_format: "s16le",
				enable_speaker_diarization: false,
				language_hints: ["uk"],
				num_channels: 1,
				sample_rate: 16_000,
			}),
		);
		await expect
			.poll(() => e2eLibrary.savedTexts())
			.toEqual(["Hello from realtime"]);
	} finally {
		bff.server.closeAllConnections?.();
		upstream.server.closeAllConnections?.();
		await browser.close();
		await bff.close();
		await upstream.close();
	}
});
