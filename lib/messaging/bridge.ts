import type { Message } from "./types";

export function sendMessage(message: Message): Promise<void> {
	return chrome.runtime.sendMessage(message).catch(() => {
		// Ignore "no receiving end" errors — expected when
		// side panel is closed or offscreen not yet loaded
	});
}

export function onMessage(
	handler: (message: Message, sender: chrome.runtime.MessageSender) => void,
): () => void {
	const listener = (
		message: unknown,
		sender: chrome.runtime.MessageSender,
		sendResponse: () => void,
	) => {
		handler(message as Message, sender);
		// Return false to indicate synchronous handling (no async response)
		return false;
	};
	chrome.runtime.onMessage.addListener(listener);
	return () => chrome.runtime.onMessage.removeListener(listener);
}
