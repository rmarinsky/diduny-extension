import { expect, test } from "bun:test";
import { saveExtensionRecording } from "./library";

test("saves an extension recording through the extension-only BFF routes", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ init?: RequestInit; url: string }> = [];
	globalThis.fetch = (async (url, init) => {
		calls.push({ init, url: String(url) });
		return calls.length === 1
			? Response.json(
					{ id: "f0e11966-578b-4854-926b-8a32cf0dc9fd" },
					{ status: 201 },
				)
			: Response.json({ id: "saved" }, { status: 201 });
	}) as typeof fetch;

	try {
		const audio = new Blob(["audio"], { type: "audio/webm" });
		await saveExtensionRecording(
			{
				audio,
				durationSeconds: 2,
				text: "Saved after delivery",
				type: "voice",
			},
			"http://localhost:4317",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}

	expect(calls[0]).toMatchObject({
		init: expect.objectContaining({ credentials: "include", method: "POST" }),
		url: "http://localhost:4317/bff/extension/library",
	});
	expect(calls[1]).toMatchObject({
		init: expect.objectContaining({
			body: expect.any(Blob),
			headers: { "content-type": "audio/webm" },
			method: "PUT",
		}),
		url: "http://localhost:4317/bff/extension/library/f0e11966-578b-4854-926b-8a32cf0dc9fd/media",
	});
});
