import type { Message } from "./types";

export function sendMessage(message: Message): Promise<void> {
	return chrome.runtime.sendMessage(message).catch(() => {
		// Ignore "no receiving end" errors — expected when
		// side panel is closed or offscreen not yet loaded
	});
}

export function onMessage(
	handler: (
		message: Message,
		sender: chrome.runtime.MessageSender,
	) => void | Promise<void>,
): () => void {
	const listener = (
		message: unknown,
		sender: chrome.runtime.MessageSender,
		sendResponse: () => void,
	) => {
		const result = handler(message as Message, sender);
		if (!result) return false;
		void result.finally(sendResponse);
		return true;
	};
	chrome.runtime.onMessage.addListener(listener);
	return () => chrome.runtime.onMessage.removeListener(listener);
}
