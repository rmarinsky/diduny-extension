import { expect, test } from "bun:test";
import { buildServer } from "../server";
import { InMemorySessionStore } from "../src/server/session-store";

test("forwards multipart transcription uploads without serializing the audio stream", async () => {
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only-token" });
	let upstreamBody;
	const server = await buildServer({
		fetch: async (_url, init) => {
			upstreamBody = init?.body;
			return Response.json({ text: "transcribed", tokens: [] });
		},
		sessions,
		upstreamUrl: "http://upstream.test",
	});
	const boundary = "diduny-boundary";
	const payload = [
		`--${boundary}`,
		'Content-Disposition: form-data; name="audio"; filename="recording.webm"',
		"Content-Type: audio/webm",
		"",
		"audio-bytes",
		`--${boundary}--`,
		"",
	].join("\r\n");

	const response = await server.inject({
		headers: {
			"content-type": `multipart/form-data; boundary=${boundary}`,
			cookie: `diduny_session=${sessionId}`,
		},
		method: "POST",
		payload,
		url: "/bff/api/transcriptions",
	});

	expect(response.statusCode).toBe(200);
	expect(upstreamBody).not.toBe(JSON.stringify({}));
	expect(typeof upstreamBody).not.toBe("string");

	await server.close();
});
