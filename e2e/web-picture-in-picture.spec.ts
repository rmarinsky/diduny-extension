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

test("the optional floating live panel receives tokens and returns safely to the page", async () => {
	const upstream = Fastify();
	await upstream.register(websocket);
	upstream.get("/api/v1/usage/me", async () => ({ remaining_seconds: 60 }));
	upstream.post("/api/v1/auth/send-otp", async () => ({}));
	upstream.post("/api/v1/auth/verify-otp", async () => ({
		accessToken: "pip-token",
		accessTokenExpiresAt: Date.now() + 300_000,
		refreshToken: "pip-refresh",
		user: { email: "pip@example.com" },
	}));
	upstream.get("/api/v1/realtime", { websocket: true }, (socket) => {
		socket.send('{"type":"proxy_ready"}');
		let sentTokens = false;
		socket.on("message", (_data, isBinary) => {
			if (!isBinary || sentTokens) return;
			sentTokens = true;
			socket.send(
				'{"tokens":[{"text":"Floating ","is_final":true},{"text":"panel","is_final":false}]}',
			);
		});
	});
	await upstream.listen({ host: "localhost", port: 0 });
	const bff = await buildServer({
		library: createE2eLibrary().library,
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
	await context.addInitScript(() => {
		Object.defineProperty(window, "documentPictureInPicture", {
			configurable: true,
			value: {
				async requestWindow() {
					const floating = window.open("about:blank", "diduny-pip");
					if (!floating) throw new Error("Could not open floating panel");
					floating.document.write(
						"<!doctype html><html><head></head><body></body></html>",
					);
					floating.document.close();
					return floating;
				},
			},
		});
	});
	const page = await context.newPage();

	try {
		await page.goto(`${bffUrl}/`);
		await page.getByLabel("Email").fill("pip@example.com");
		await page.getByRole("button", { name: "Send one-time code" }).click();
		await page.getByLabel("One-time code").fill("123456");
		await page.getByRole("button", { name: "Sign in", exact: true }).click();
		await page.getByRole("button", { name: "Start dictation" }).click();
		await expect(page.getByTestId("live-final-text")).toHaveText("Floating ");

		const popupReady = page.waitForEvent("popup");
		await page.getByRole("button", { name: "Float live panel" }).click();
		const floating = await popupReady;
		await expect(floating.getByText("Live transcript")).toBeVisible();
		await expect(floating.getByTestId("live-final-text")).toHaveText(
			"Floating ",
		);
		await expect(floating.getByTestId("live-provisional-text")).toHaveText(
			"panel",
		);

		const closed = floating.waitForEvent("close");
		await floating
			.getByRole("button", { name: "Return live panel to page" })
			.click();
		await closed;
		await expect(page.getByTestId("live-final-text")).toHaveText("Floating ");
		await page.getByRole("button", { name: "Cancel" }).click();
	} finally {
		bff.server.closeAllConnections?.();
		upstream.server.closeAllConnections?.();
		await browser.close();
		await bff.close();
		await upstream.close();
	}
});
