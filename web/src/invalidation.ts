interface InvalidationChannel {
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<unknown>) => void,
	): void;
	close(): void;
	postMessage(message: unknown): void;
	removeEventListener(
		type: "message",
		listener: (event: MessageEvent<unknown>) => void,
	): void;
}

function isInvalidation(value: unknown) {
	return (
		!!value &&
		typeof value === "object" &&
		Object.keys(value).length === 1 &&
		(value as { type?: unknown }).type === "invalidate"
	);
}

export function createWorkspaceInvalidationBus(
	channel: InvalidationChannel | undefined = typeof BroadcastChannel ===
	"function"
		? new BroadcastChannel("diduny-workspace")
		: undefined,
) {
	return {
		close() {
			channel?.close();
		},
		invalidate() {
			channel?.postMessage({ type: "invalidate" });
		},
		subscribe(listener: () => void) {
			if (!channel) return () => {};
			const onMessage = (event: MessageEvent<unknown>) => {
				if (isInvalidation(event.data)) listener();
			};
			channel.addEventListener("message", onMessage);
			return () => channel.removeEventListener("message", onMessage);
		},
	};
}
