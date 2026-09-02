import { expect, test } from "bun:test";
import type { ScratchRecording } from "../../web/src/scratch-storage";
import { saveRecoveredExtensionRecordings } from "./library";

test("replays recovered extension scratch independently and leaves failed recordings for a later retry", async () => {
	const firstId = "2c602e2c-5afb-4a7b-bf58-6e314da22183";
	const failedId = "28748509-baed-43c0-b900-54b776630e7a";
	const thirdId = "e53055d0-342f-46f4-b3c5-ed7a794e2838";
	const recovered = [
		{
			audio: new Blob(["first recovered audio"], { type: "audio/wav" }),
			durationSeconds: 3,
			id: firstId,
			text: "First recovered extension capture",
		},
		{
			audio: new Blob(["failed recovered audio"], { type: "audio/wav" }),
			durationSeconds: 4,
			id: failedId,
			text: "Retry this recovered extension capture later",
		},
		{
			audio: new Blob(["third recovered audio"], { type: "audio/wav" }),
			durationSeconds: 5,
			id: thirdId,
			text: "Continue after another recovery failure",
		},
	] satisfies readonly ScratchRecording[];
	const discarded: string[] = [];
	const storage = {
		discard: async (id: string) => {
			discarded.push(id);
		},
	};
	const originalFetch = globalThis.fetch;
	const calls: Array<{ init?: RequestInit; url: string }> = [];
	globalThis.fetch = (async (url, init) => {
		calls.push({ init, url: String(url) });
		if (init?.method === "POST") {
			const key = new Headers(init.headers).get("idempotency-key");
			if (key === failedId) return new Response(null, { status: 500 });
			return Response.json({ id: `saved-${key}` }, { status: 201 });
		}
		return Response.json({ id: "saved" }, { status: 201 });
	}) as typeof fetch;

	try {
		await saveRecoveredExtensionRecordings(
			recovered,
			storage,
			"http://localhost:4317",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}

	const posts = calls.filter((call) => call.init?.method === "POST");
	expect(
		posts.map((call) => new Headers(call.init?.headers).get("idempotency-key")),
	).toEqual([firstId, failedId, thirdId]);
	expect(
		posts.map((call) => JSON.parse(String(call.init?.body)).status),
	).toEqual(["partiallyRecovered", "partiallyRecovered", "partiallyRecovered"]);
	expect(calls.filter((call) => call.init?.method === "PUT")).toHaveLength(2);
	expect(discarded).toEqual([firstId, thirdId]);
});
