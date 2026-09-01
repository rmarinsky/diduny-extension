import {
	RealtimeSession,
	type RealtimeToken,
} from "../../src/core/realtime-session";

export interface WebRealtimeSession {
	close(): void;
	finalize(): void;
	readonly result: Promise<string>;
	sendAudio(frame: Int16Array): void;
}

function realtimeUrl(location = window.location) {
	const url = new URL("/bff/realtime", location.href);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.href;
}

export function startWebRealtime({
	config,
	endpoint = realtimeUrl(),
	onTokens,
}: {
	config: Record<string, unknown>;
	endpoint?: string;
	onTokens(tokens: readonly RealtimeToken[]): void;
}): WebRealtimeSession {
	let resolveResult: (text: string) => void = () => {};
	let rejectResult: (reason: unknown) => void = () => {};
	const result = new Promise<string>((resolve, reject) => {
		resolveResult = resolve;
		rejectResult = reject;
	});
	const session = new RealtimeSession({
		connect(handlers) {
			const socket = new WebSocket(endpoint);
			socket.binaryType = "arraybuffer";
			socket.addEventListener("open", () => {
				socket.send(JSON.stringify(config));
			});
			socket.addEventListener("message", (event) => {
				if (typeof event.data === "string") handlers.message(event.data);
			});
			socket.addEventListener("close", (event) => {
				handlers.close({ code: event.code });
			});
			return {
				close: () => socket.close(),
				send: (frame) => socket.send(frame),
			};
		},
		onComplete: resolveResult,
		onError: rejectResult,
		onTokens,
		scheduler: window,
	});
	void result.catch(() => {});
	session.start();
	return {
		close: () => session.close(),
		finalize: () => session.finalize(),
		result,
		sendAudio: (frame) =>
			session.sendAudio(
				new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength),
			),
	};
}
