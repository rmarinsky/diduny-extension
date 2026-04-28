import type { RealtimeConfig, TranscriptionToken } from "../types";
import { WS_URL } from "../types";

export interface WSClientOptions {
	accessToken: string;
	config: RealtimeConfig;
	onTokens: (tokens: TranscriptionToken[]) => void;
	onComplete: (text: string) => void;
	onError: (error: string) => void;
	onReady: () => void;
	/** Called for transient errors that will be retried (e.g. WS disconnect with retries left). */
	onWarning?: (warning: string) => void;
}

export class RealtimeWSClient {
	private ws: WebSocket | null = null;
	private ready = false;
	private buffer: ArrayBuffer[] = [];
	private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
	private finalText = "";
	private lastError: string | null = null;
	private finalizing = false;
	private completed = false;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 3;
	private opts: WSClientOptions;

	constructor(opts: WSClientOptions) {
		this.opts = opts;
	}

	connect(): void {
		const url = `${WS_URL}/api/v1/realtime?token=${this.opts.accessToken}`;
		this.ws = new WebSocket(url);

		this.ws.onopen = () => {
			this.lastError = null;
			this.finalizing = false;
			this.completed = false;
			this.reconnectAttempts = 0;
			this.ws?.send(JSON.stringify(this.opts.config));
			// Start keepalive: empty binary every 25s
			this.keepaliveInterval = setInterval(() => {
				if (this.ws?.readyState === WebSocket.OPEN) {
					this.ws.send(new ArrayBuffer(0));
				}
			}, 25_000);
		};

		this.ws.onmessage = (event) => {
			if (typeof event.data !== "string") return;

			const msg = JSON.parse(event.data);

			if (msg.type === "proxy_ready") {
				this.ready = true;
				// Flush buffered frames
				for (const frame of this.buffer) {
					this.ws?.send(frame);
				}
				this.buffer = [];
				this.opts.onReady();
				return;
			}

			if (msg.error) {
				this.reportError(msg.error);
				return;
			}

			if (msg.finished) {
				this.completed = true;
				this.opts.onComplete(this.finalText);
				return;
			}

			// Transcript tokens
			if (msg.tokens) {
				const tokens: TranscriptionToken[] = msg.tokens;
				// Build final text from final tokens, filtering control tags
				for (const t of tokens) {
					if (t.is_final) {
						const clean = t.text.replace(/<\/?(?:end|fin|eos)>/gi, "");
						if (clean) this.finalText += clean;
					}
				}
				this.opts.onTokens(tokens);
			}
		};

		this.ws.onerror = () => {
			// Don't report as fatal error — onclose will fire next and handle reconnection
			this.opts.onWarning?.("WebSocket connection error, will retry");
		};

		this.ws.onclose = (event) => {
			this.cleanup();
			if (this.completed || this.finalizing) {
				return;
			}
			// Attempt reconnection on unexpected close
			if (
				!event.wasClean &&
				this.reconnectAttempts < this.maxReconnectAttempts
			) {
				this.reconnectAttempts++;
				const delay = 1000 * this.reconnectAttempts;
				this.opts.onWarning?.(
					`Connection lost, reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`,
				);
				setTimeout(() => this.connect(), delay);
				return;
			}
			if (!event.wasClean && !this.lastError) {
				this.reportError(`Connection closed: ${event.code}`);
			}
		};
	}

	sendAudio(pcmBuffer: ArrayBuffer): void {
		if (!this.ready) {
			if (this.buffer.length < 100) {
				this.buffer.push(pcmBuffer);
			}
			return;
		}
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(pcmBuffer);
		}
	}

	finalize(): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.finalizing = true;
			this.ws.send(JSON.stringify({ type: "finalize" }));
			this.ws.send(new ArrayBuffer(0));
		}
	}

	getFinalText(): string {
		return this.finalText;
	}

	close(): void {
		this.cleanup();
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	private cleanup(): void {
		if (this.keepaliveInterval) {
			clearInterval(this.keepaliveInterval);
			this.keepaliveInterval = null;
		}
		this.ready = false;
		this.buffer = [];
	}

	private reportError(error: string): void {
		if (this.lastError === error) {
			return;
		}
		this.lastError = error;
		this.opts.onError(error);
	}
}
