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

export function getTabCaptureStreamId(
	tabCapture: TabCaptureApi,
	runtime: ChromeRuntimeError,
	targetTabId: number,
): Promise<string> {
	return new Promise((resolve, reject) => {
		tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
			const message = runtime.lastError?.message;
			if (message) {
				reject(new Error(message));
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
