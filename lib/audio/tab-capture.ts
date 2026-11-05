export interface TabCaptureApi {
	getMediaStreamId(
		options: { targetTabId: number },
		callback: (streamId: string) => void,
	): void;
}

export interface ChromeRuntimeError {
	lastError?: { message?: string };
}

export interface TabCaptureAudioConstraints {
	audio: {
		mandatory: {
			chromeMediaSource: "tab";
			chromeMediaSourceId: string;
		};
	};
	video: false;
}

export const TAB_CAPTURE_NOT_INVOKED_MESSAGE =
	"Chrome lets Diduny record a tab only after you click the Diduny toolbar button on it. Click it on the meeting tab, then start the meeting recording.";
export const TAB_CAPTURE_BROWSER_PAGE_MESSAGE =
	"Chrome pages cannot be recorded. Open the meeting in a normal web tab, then start the meeting recording.";

/** Chrome's refusal names a permission; tell the user what to click instead. */
export function tabCaptureFailureMessage(
	chromeMessage: string,
	tabUrl?: string,
) {
	if (tabUrl && !/^https?:/i.test(tabUrl))
		return TAB_CAPTURE_BROWSER_PAGE_MESSAGE;
	if (/has not been invoked|activeTab/i.test(chromeMessage))
		return TAB_CAPTURE_NOT_INVOKED_MESSAGE;
	if (/Chrome pages cannot be captured/i.test(chromeMessage))
		return TAB_CAPTURE_BROWSER_PAGE_MESSAGE;
	return chromeMessage;
}

export function getTabCaptureStreamId(
	tabCapture: TabCaptureApi,
	runtime: ChromeRuntimeError,
	targetTabId: number,
	tabUrl?: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
			const message = runtime.lastError?.message;
			if (message) {
				reject(new Error(tabCaptureFailureMessage(message, tabUrl)));
				return;
			}
			if (!streamId) {
				reject(new Error("Could not capture the selected browser tab"));
				return;
			}
			resolve(streamId);
		});
	});
}

export function tabAudioConstraints(
	streamId: string,
): TabCaptureAudioConstraints {
	return {
		audio: {
			mandatory: {
				chromeMediaSource: "tab",
				chromeMediaSourceId: streamId,
			},
		},
		video: false,
	};
}
