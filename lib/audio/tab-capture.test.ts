import { expect, test } from "bun:test";
import { getTabCaptureStreamId, tabAudioConstraints } from "./tab-capture";

test("creates one tab-only stream id and redeems it with audio-only constraints", async () => {
	const requests: unknown[] = [];
	const streamId = await getTabCaptureStreamId(
		{
			getMediaStreamId(options, callback) {
				requests.push(options);
				callback("tab-stream-id");
			},
		},
		{},
		41,
	);

	expect(streamId).toBe("tab-stream-id");
	expect(requests).toEqual([{ targetTabId: 41 }]);
	expect(tabAudioConstraints(streamId)).toEqual({
		audio: {
			mandatory: {
				chromeMediaSource: "tab",
				chromeMediaSourceId: "tab-stream-id",
			},
		},
		video: false,
	});
});

test("keeps a tab-capture failure visible instead of falling back to screen capture", async () => {
	await expect(
		getTabCaptureStreamId(
			{
				getMediaStreamId(_options, callback) {
					callback("");
				},
			},
			{ lastError: { message: "Capture refused" } },
			41,
		),
	).rejects.toThrow("Capture refused");
});
