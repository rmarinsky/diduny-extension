import type { Message } from "./types";

export function sendMessage(message: Message): Promise<void> {
	return chrome.runtime.sendMessage(message).catch(() => {
		// Ignore "no receiving end" errors — expected when
		// side panel is closed or offscreen not yet loaded
	});
}

export function onMessage(
	handler: (message: Message, sender: chrome.runtime.MessageSender) => unknown,
): () => void {
	const listener = (
		message: unknown,
		sender: chrome.runtime.MessageSender,
		sendResponse: () => void,
	) => {
		const result = handler(message as Message, sender);
		if (!(result instanceof Promise)) return false;
		void result.then(
			(handled) => {
				if (handled === true) sendResponse();
			},
			(error) => {
				sendResponse();
				queueMicrotask(() => {
					throw error;
				});
			},
		);
		return true;
	};
	chrome.runtime.onMessage.addListener(listener);
	return () => chrome.runtime.onMessage.removeListener(listener);
}
