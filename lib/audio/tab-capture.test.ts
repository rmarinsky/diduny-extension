import { expect, test } from "bun:test";
import {
	TAB_CAPTURE_BROWSER_PAGE_MESSAGE,
	TAB_CAPTURE_NOT_INVOKED_MESSAGE,
	getTabCaptureStreamId,
	tabAudioConstraints,
	tabCaptureFailureMessage,
} from "./tab-capture";

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

test("explains Chrome's activeTab refusal instead of showing its developer wording", async () => {
	const refusal =
		"Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.";
	expect(
		tabCaptureFailureMessage(refusal, "http://localhost:3999/meeting"),
	).toBe(TAB_CAPTURE_NOT_INVOKED_MESSAGE);
	expect(tabCaptureFailureMessage(refusal, "chrome://newtab/")).toBe(
		TAB_CAPTURE_BROWSER_PAGE_MESSAGE,
	);
	await expect(
		getTabCaptureStreamId(
			{ getMediaStreamId: (_options, callback) => callback("") },
			{ lastError: { message: refusal } },
			41,
			"https://meet.example.com/abc",
		),
	).rejects.toThrow(TAB_CAPTURE_NOT_INVOKED_MESSAGE);
});
