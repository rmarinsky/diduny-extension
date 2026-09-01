import type { FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket as DownstreamSocket, RawData } from "ws";
import { sessionCookieName, sessionIdFromCookie } from "./relay";
import type { BffSession, SessionStore } from "./session-store";

export const REALTIME_CLOSE_CODES = {
	backpressure: 1013,
	quotaExceeded: 4002,
	upstreamUnavailable: 1011,
} as const;

const MAX_BUFFERED_BYTES = 1_000_000;

type RealtimeRequest = FastifyRequest & {
	didunyRealtimeSession?: { id: string; session: BffSession };
};

function upstreamRealtimeUrl(upstreamUrl: string, accessToken: string) {
	const url = new URL("/api/v1/realtime", upstreamUrl);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("token", accessToken);
	return url.href;
}

function reasonText(value: Buffer) {
	return value.toString().slice(0, 123);
}

function closeCode(code: number) {
	if (code === 1000) return code;
	if (code >= 3000 && code <= 4999) return code;
	return 1000;
}

function binaryPayload(data: RawData) {
	if (Array.isArray(data)) return Buffer.concat(data);
	return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}

function payloadSize(data: RawData) {
	if (typeof data === "string") return Buffer.byteLength(data);
	if (Array.isArray(data))
		return data.reduce((total, item) => total + item.byteLength, 0);
	return data.byteLength;
}

export class RealtimeRelay {
	private readonly activeSessions = new Set<string>();
	private readonly reservedSessions = new Set<string>();
	private activeSockets = 0;

	constructor(
		private readonly fetch: typeof globalThis.fetch,
		private readonly sessions: SessionStore,
		private readonly upstreamUrl: string,
	) {}

	get activeUpstreamSockets() {
		return this.activeSockets;
	}

	async authorizeUpgrade(
		request: FastifyRequest,
		reply: FastifyReply,
		cookieName = sessionCookieName,
	) {
		const id = sessionIdFromCookie(request.headers.cookie, cookieName);
		const session = id ? await this.sessions.get(id) : null;
		if (!id || !session) {
			return reply.code(401).send({ error: "unauthenticated" });
		}
		if (this.activeSessions.has(id) || this.reservedSessions.has(id)) {
			return reply.code(409).send({ error: "realtime_session_active" });
		}
		this.reservedSessions.add(id);
		(request as RealtimeRequest).didunyRealtimeSession = { id, session };
	}

	connect(downstream: DownstreamSocket, request: FastifyRequest) {
		const connection = (request as RealtimeRequest).didunyRealtimeSession;
		if (!connection) {
			downstream.close(
				REALTIME_CLOSE_CODES.upstreamUnavailable,
				"not authorized",
			);
			return;
		}

		const { id, session } = connection;
		this.reservedSessions.delete(id);
		this.activeSessions.add(id);

		let upstream: WebSocket | undefined;
		const pendingFrames: Array<{ data: RawData; isBinary: boolean }> = [];
		let pendingBytes = 0;
		let cleaned = false;
		let counted = false;
		const cleanup = () => {
			if (cleaned) return;
			cleaned = true;
			this.activeSessions.delete(id);
			this.reservedSessions.delete(id);
			if (counted) this.activeSockets -= 1;
		};
		const closeDownstream = (code: number, reason: string) => {
			if (downstream.readyState === downstream.OPEN)
				downstream.close(code, reason);
		};
		const closeUpstream = (code: number, reason: string) => {
			if (upstream?.readyState === WebSocket.OPEN) upstream.close(code, reason);
		};

		const forward = (data: RawData, isBinary: boolean) => {
			if (
				downstream.bufferedAmount > MAX_BUFFERED_BYTES ||
				(upstream && upstream.bufferedAmount > MAX_BUFFERED_BYTES)
			) {
				closeDownstream(REALTIME_CLOSE_CODES.backpressure, "backpressure");
				closeUpstream(REALTIME_CLOSE_CODES.backpressure, "backpressure");
				return false;
			}
			if (!upstream || upstream.readyState !== WebSocket.OPEN) {
				pendingBytes += payloadSize(data);
				if (pendingBytes > MAX_BUFFERED_BYTES) {
					closeDownstream(
						REALTIME_CLOSE_CODES.backpressure,
						"pre-ready buffer full",
					);
					return false;
				}
				pendingFrames.push({ data, isBinary });
				return true;
			}
			upstream.send(isBinary ? binaryPayload(data) : data.toString());
			return true;
		};
		downstream.on("message", (data, isBinary) => {
			forward(data, isBinary);
		});
		downstream.on("close", (code, reason) => {
			closeUpstream(closeCode(code), reasonText(reason));
			cleanup();
		});
		downstream.on("error", () => {
			closeUpstream(
				REALTIME_CLOSE_CODES.upstreamUnavailable,
				"downstream error",
			);
			cleanup();
		});

		void this.checkUsage(session)
			.then(() => {
				if (cleaned) return;
				upstream = new WebSocket(
					upstreamRealtimeUrl(this.upstreamUrl, session.accessToken),
				);
				upstream.binaryType = "arraybuffer";
				counted = true;
				this.activeSockets += 1;
				upstream.addEventListener("open", () => {
					for (const frame of pendingFrames.splice(0)) {
						pendingBytes -= payloadSize(frame.data);
						forward(frame.data, frame.isBinary);
					}
				});
				upstream.addEventListener("message", (event) => {
					if (downstream.readyState !== downstream.OPEN) return;
					const data = event.data;
					if (typeof data === "string") {
						downstream.send(data);
					} else if (data instanceof ArrayBuffer) {
						downstream.send(Buffer.from(data), { binary: true });
					}
				});
				upstream.addEventListener("close", (event) => {
					closeDownstream(closeCode(event.code), event.reason);
					cleanup();
				});
				upstream.addEventListener("error", () => {
					closeDownstream(
						REALTIME_CLOSE_CODES.upstreamUnavailable,
						"upstream unavailable",
					);
					cleanup();
				});
			})
			.catch((error) => {
				const code =
					error instanceof UsageExceededError
						? REALTIME_CLOSE_CODES.quotaExceeded
						: REALTIME_CLOSE_CODES.upstreamUnavailable;
				closeDownstream(
					code,
					code === REALTIME_CLOSE_CODES.quotaExceeded
						? "usage exhausted"
						: "usage check failed",
				);
				cleanup();
			});
	}

	private async checkUsage(session: BffSession) {
		const response = await this.fetch(
			`${this.upstreamUrl.replace(/\/$/, "")}/api/v1/usage/me`,
			{ headers: { authorization: `Bearer ${session.accessToken}` } },
		);
		if (response.status === 402) throw new UsageExceededError();
		if (!response.ok) throw new Error("usage check failed");
	}
}

class UsageExceededError extends Error {}
