import type { Message } from "./types";

export function sendMessage(message: Message): Promise<void> {
	return chrome.runtime.sendMessage(message).catch(() => {
		// Ignore "no receiving end" errors — expected when
		// side panel is closed or offscreen not yet loaded
	});
}

export async function sendMessageUntilAcknowledged(
	message: Message,
	retryDelayMs = 200,
): Promise<void> {
	for (;;) {
		try {
			const response = await chrome.runtime.sendMessage(message);
			if (response?.acknowledged === true) return;
		} catch {
			// A stopped service worker will be restarted by the next attempt.
		}
		await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
	}
}

export function onMessage(
	handler: (message: Message, sender: chrome.runtime.MessageSender) => unknown,
): () => void {
	const listener = (
		message: unknown,
		sender: chrome.runtime.MessageSender,
		sendResponse: (response?: unknown) => void,
	) => {
		const result = handler(message as Message, sender);
		if (!(result instanceof Promise)) return false;
		void result.then(
			(handled) => {
				if (handled === true) sendResponse({ acknowledged: true });
			},
			(error) => {
				sendResponse({ acknowledged: false });
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
