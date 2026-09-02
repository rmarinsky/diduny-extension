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

test("flushes an interrupted recording and recovers its surviving audio through the BFF", async () => {
	const upstream = Fastify();
	await upstream.register(websocket);
	upstream.post("/api/v1/auth/send-otp", async () => ({}));
	upstream.post("/api/v1/auth/verify-otp", async () => ({
		accessToken: "recovery-token",
		accessTokenExpiresAt: Date.now() + 300_000,
		refreshToken: "recovery-refresh",
		user: { email: "recovery@example.com" },
	}));
	upstream.get("/api/v1/realtime", { websocket: true }, (socket) => {
		socket.send('{"type":"proxy_ready"}');
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
	const interruptedPage = await context.newPage();

	try {
		await interruptedPage.goto(`${bffUrl}/`);
		await interruptedPage.getByLabel("Email").fill("recovery@example.com");
		await interruptedPage
			.getByRole("button", { name: "Send one-time code" })
			.click();
		await interruptedPage.getByLabel("One-time code").fill("123456");
		await interruptedPage
			.getByRole("button", { name: "Sign in", exact: true })
			.click();
		await interruptedPage
			.getByRole("button", { name: "Start dictation" })
			.click();
		await expect(
			interruptedPage.getByText("1s", { exact: true }),
		).toBeVisible();
		await interruptedPage.evaluate(() =>
			document.dispatchEvent(new Event("visibilitychange")),
		);
		await interruptedPage.close({ runBeforeUnload: false });

		const recoveredPage = await context.newPage();
		await recoveredPage.goto(`${bffUrl}/`);
		await expect
			.poll(() => e2eLibrary.recordings())
			.toEqual([
				expect.objectContaining({
					durationSeconds: expect.any(Number),
					media: expect.objectContaining({ contentType: "audio/wav" }),
					status: "partiallyRecovered",
				}),
			]);
		const recovered = e2eLibrary.recordings()[0];
		expect(recovered?.durationSeconds).toBeGreaterThan(0);
		const header = e2eLibrary.mediaHeader(recovered?.id ?? "");
		expect(new TextDecoder().decode(header?.subarray(0, 4))).toBe("RIFF");
		expect(
			new DataView(
				header?.buffer ?? new ArrayBuffer(),
				header?.byteOffset,
				header?.byteLength,
			).getUint32(40, true),
		).toBeGreaterThan(0);
		await recoveredPage.getByRole("button", { name: "Library" }).click();
		await recoveredPage
			.getByRole("button", { name: "Untitled recording" })
			.click();
		await expect(recoveredPage.getByText("Recovered recording")).toBeVisible();
	} finally {
		bff.server.closeAllConnections?.();
		upstream.server.closeAllConnections?.();
		await browser.close();
		await bff.close();
		await upstream.close();
	}
});
