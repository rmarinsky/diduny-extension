import { FINALIZE_PROFILES, REALTIME } from "./constants";

export type RealtimeErrorCode =
	| "quota_exhausted"
	| "realtime_buffer_overflow"
	| "realtime_ready_timeout"
	| "realtime_unavailable";

export class RealtimeSessionError extends Error {
	constructor(readonly code: RealtimeErrorCode) {
		super(code);
	}
}

export interface RealtimeScheduler {
	clearTimeout(handle: unknown): void;
	setTimeout(callback: () => void, delayMs: number): unknown;
}

export interface RealtimeSocket {
	close(): void;
	send(frame: string | Uint8Array): void;
}

export interface RealtimeSocketHandlers {
	close(event: { code: number }): void;
	message(payload: unknown): void;
}

export interface RealtimeToken {
	isFinal: boolean;
	text: string;
}

export interface RealtimeSessionOptions {
	connect(handlers: RealtimeSocketHandlers): RealtimeSocket;
	onComplete(text: string): void;
	onError(error: RealtimeSessionError): void;
	onTokens(tokens: readonly RealtimeToken[]): void;
	profile?: keyof typeof FINALIZE_PROFILES;
	scheduler: RealtimeScheduler;
}

function controlFree(text: string) {
	return text
		.replaceAll(REALTIME.endpointControlToken, "")
		.replaceAll(REALTIME.finalizeControlToken, "");
}

function messageRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value === "string") {
		try {
			return messageRecord(JSON.parse(value));
		} catch {
			return null;
		}
	}
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function messageTokens(value: unknown): RealtimeToken[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const token = item as Record<string, unknown>;
		if (typeof token.text !== "string") return [];
		const text = controlFree(token.text);
		return text ? [{ isFinal: token.is_final === true, text }] : [];
	});
}

export class RealtimeSession {
	private completed = false;
	private connection = 0;
	private finalText = "";
	private finalizeControlTimer: unknown;
	private finalizeTimeout: unknown;
	private finalizing = false;
	private flushing = false;
	private pendingBytes = 0;
	private pendingFrames: Uint8Array[] = [];
	private reconnectAttempts = 0;
	private reconnectTimer: unknown;
	private ready = false;
	private socket: RealtimeSocket | null = null;
	private terminal = false;
	private tokenTimer: unknown;
	private tokenUpdates: RealtimeToken[] = [];
	private watchdogTimer: unknown;

	constructor(private readonly options: RealtimeSessionOptions) {}

	start() {
		if (this.socket || this.terminal) return;
		this.openSocket();
	}

	sendAudio(frame: Uint8Array) {
		if (this.terminal || this.finalizing) return;
		if (!this.ready || this.flushing || !this.socket) {
			this.queue(frame);
			return;
		}
		this.socket.send(frame);
	}

	finalize() {
		if (this.terminal || this.completed || this.finalizing) return;
		this.finalizing = true;
		this.scheduleFinalizeControl(this.profile.controlMessageDelayMs);
	}

	close() {
		this.terminal = true;
		this.clearTimers();
		const socket = this.socket;
		this.socket = null;
		this.ready = false;
		socket?.close();
	}

	private get profile() {
		return FINALIZE_PROFILES[this.options.profile ?? "dictationFast"];
	}

	private openSocket() {
		const connection = ++this.connection;
		this.ready = false;
		this.socket = this.options.connect({
			close: (event) => {
				if (connection === this.connection) this.handleClose(event.code);
			},
			message: (payload) => {
				if (connection === this.connection) this.handleMessage(payload);
			},
		});
		this.watchdogTimer = this.options.scheduler.setTimeout(
			() => this.fail("realtime_ready_timeout"),
			REALTIME.readyWatchdogMs,
		);
	}

	private handleClose(code: number) {
		this.clearWatchdog();
		this.socket = null;
		this.ready = false;
		if (this.terminal || this.completed) return;
		if (code === REALTIME.quotaCloseCode) {
			this.fail("quota_exhausted");
			return;
		}
		if (this.reconnectAttempts >= REALTIME.maxReconnectAttempts) {
			this.fail("realtime_unavailable");
			return;
		}
		this.reconnectAttempts += 1;
		this.reconnectTimer = this.options.scheduler.setTimeout(() => {
			this.reconnectTimer = undefined;
			if (!this.terminal) this.openSocket();
		}, REALTIME.reconnectBackoffMs * this.reconnectAttempts);
	}

	private handleMessage(payload: unknown) {
		const message = messageRecord(payload);
		if (!message || this.terminal) return;
		if (message.type === "proxy_ready") {
			this.ready = true;
			this.clearWatchdog();
			this.flushPendingFrames();
			if (this.finalizing && !this.finalizeControlTimer) {
				this.scheduleFinalizeControl(this.profile.controlMessageDelayMs);
			}
			return;
		}
		const tokens = messageTokens(message.tokens);
		if (tokens.length) {
			for (const token of tokens) {
				if (token.isFinal) this.finalText += token.text;
			}
			this.tokenUpdates.push(...tokens);
			this.scheduleTokenUpdate();
			if (this.finalizing && this.finalizeControlTimer) {
				this.scheduleFinalizeControl(this.profile.quietWindowMs);
			}
		}
		if (message.finished === true) {
			this.completed = true;
			this.clearFinalizeTimers();
			this.flushTokenUpdates();
			this.options.onComplete(this.finalText);
			this.close();
		}
	}

	private queue(frame: Uint8Array) {
		this.pendingBytes += frame.byteLength;
		if (this.pendingBytes > REALTIME.preReadyBufferBytes) {
			this.fail("realtime_buffer_overflow");
			return;
		}
		this.pendingFrames.push(frame);
	}

	private flushPendingFrames() {
		if (!this.socket || this.flushing) return;
		this.flushing = true;
		while (this.pendingFrames.length && this.socket) {
			const frame = this.pendingFrames.shift();
			if (!frame) continue;
			this.pendingBytes -= frame.byteLength;
			this.socket.send(frame);
		}
		this.flushing = false;
	}

	private scheduleTokenUpdate() {
		if (this.tokenTimer) return;
		this.tokenTimer = this.options.scheduler.setTimeout(
			() => this.flushTokenUpdates(),
			1_000 / REALTIME.uiUpdatesPerSecond,
		);
	}

	private flushTokenUpdates() {
		this.tokenTimer = undefined;
		if (!this.tokenUpdates.length) return;
		const tokens = this.tokenUpdates;
		this.tokenUpdates = [];
		this.options.onTokens(tokens);
	}

	private scheduleFinalizeControl(delayMs: number) {
		if (this.finalizeControlTimer)
			this.options.scheduler.clearTimeout(this.finalizeControlTimer);
		this.finalizeControlTimer = this.options.scheduler.setTimeout(() => {
			this.finalizeControlTimer = undefined;
			if (!this.socket || !this.ready || this.terminal) return;
			this.socket.send('{"type":"finalize"}');
			this.socket.send(new Uint8Array());
			this.finalizeTimeout = this.options.scheduler.setTimeout(
				() => this.fail("realtime_unavailable"),
				this.profile.timeoutMs,
			);
		}, delayMs);
	}

	private fail(code: RealtimeErrorCode) {
		if (this.terminal) return;
		this.terminal = true;
		this.clearTimers();
		const socket = this.socket;
		this.socket = null;
		this.ready = false;
		socket?.close();
		this.options.onError(new RealtimeSessionError(code));
	}

	private clearWatchdog() {
		if (!this.watchdogTimer) return;
		this.options.scheduler.clearTimeout(this.watchdogTimer);
		this.watchdogTimer = undefined;
	}

	private clearFinalizeTimers() {
		if (this.finalizeControlTimer)
			this.options.scheduler.clearTimeout(this.finalizeControlTimer);
		if (this.finalizeTimeout)
			this.options.scheduler.clearTimeout(this.finalizeTimeout);
		this.finalizeControlTimer = undefined;
		this.finalizeTimeout = undefined;
	}

	private clearTimers() {
		this.clearWatchdog();
		this.clearFinalizeTimers();
		if (this.reconnectTimer)
			this.options.scheduler.clearTimeout(this.reconnectTimer);
		if (this.tokenTimer) this.options.scheduler.clearTimeout(this.tokenTimer);
		this.reconnectTimer = undefined;
		this.tokenTimer = undefined;
	}
}
