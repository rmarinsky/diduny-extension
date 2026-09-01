import type { FastifyRequest } from "fastify";
import { HTTP } from "../core/constants";
import type { BffSession, SessionStore } from "./session-store";

export const sessionCookieName = "diduny_session";
export const extensionSessionCookieName = "diduny_extension_session";

const fixedPaths = new Set([
	"GET config",
	"GET health",
	"GET models",
	"GET translations",
	"GET usage/me",
	"POST jobs",
	"POST transcriptions",
	"POST transcriptions/clean",
]);

function isAllowedPath(method: string, path: string) {
	if (fixedPaths.has(`${method} ${path}`)) return true;
	return (
		method === "GET" &&
		/^jobs\/[^/]+(?:\/events)?$/.test(path) &&
		!path.includes("..")
	);
}

function requiresSession(path: string) {
	return path !== "config" && path !== "health";
}

export function sessionIdFromCookie(
	cookie: string | undefined,
	cookieName = sessionCookieName,
) {
	if (!cookie) return null;
	for (const part of cookie.split(";")) {
		const [name, value] = part.trim().split("=", 2);
		if (name === cookieName && value) {
			try {
				return decodeURIComponent(value);
			} catch {
				return null;
			}
		}
	}
	return null;
}

type RelayBody = string | Uint8Array | NodeJS.ReadableStream | undefined;

function isReadableStream(value: unknown): value is NodeJS.ReadableStream {
	return !!value && typeof value === "object" && "pipe" in value;
}

function requestBody(request: FastifyRequest): RelayBody {
	if (request.method === "GET" || request.method === "HEAD") return undefined;
	if (isReadableStream(request.body)) return request.body;
	if (typeof request.body === "string" || request.body instanceof Uint8Array) {
		return request.body;
	}
	return request.body === undefined ? undefined : JSON.stringify(request.body);
}

function upstreamRequestInit(
	request: FastifyRequest,
	session: BffSession | null,
	body: RelayBody,
): RequestInit {
	const init: RequestInit & { duplex?: "half" } = {
		body: body as BodyInit | undefined,
		headers: requestHeaders(request, session),
		method: request.method,
	};
	if (isReadableStream(body)) init.duplex = "half";
	return init;
}

function requestHeaders(request: FastifyRequest, session: BffSession | null) {
	const headers: Record<string, string> = {};
	if (session) headers.authorization = `Bearer ${session.accessToken}`;
	const contentType = request.headers["content-type"];
	if (typeof contentType === "string") headers["content-type"] = contentType;
	const accept = request.headers.accept;
	if (typeof accept === "string") headers.accept = accept;
	return headers;
}

export async function relayRequest({
	cookieName,
	fetch,
	refreshSession,
	request,
	sessions,
	upstreamUrl,
}: {
	fetch: typeof globalThis.fetch;
	refreshSession?: (id: string, session: BffSession) => Promise<BffSession>;
	request: FastifyRequest;
	sessions: SessionStore;
	upstreamUrl: string;
	cookieName?: string;
}): Promise<
	| { kind: "not_found" }
	| { kind: "unauthenticated" }
	| { kind: "unreachable" }
	| {
			body: Uint8Array;
			headers: Record<string, string>;
			kind: "response";
			status: number;
	  }
> {
	const path = (request.params as { "*"?: string })["*"] ?? "";
	if (!isAllowedPath(request.method, path)) return { kind: "not_found" };

	let session: BffSession | null = null;
	let sessionId: string | null = null;
	if (requiresSession(path)) {
		sessionId = sessionIdFromCookie(request.headers.cookie, cookieName);
		session = sessionId ? await sessions.get(sessionId) : null;
		if (!session) return { kind: "unauthenticated" };
	}

	const currentUrl = new URL(request.raw.url ?? "", "http://bff.local");
	const refresh = async () => {
		if (!sessionId || !session || !refreshSession) return false;
		try {
			session = await refreshSession(sessionId, session);
			return true;
		} catch {
			return false;
		}
	};
	if (
		sessionId &&
		session?.expiresAt !== undefined &&
		session.expiresAt - Date.now() <= HTTP.proactiveRefreshLeadMs &&
		refreshSession &&
		!(await refresh())
	) {
		return { kind: "unauthenticated" };
	}
	try {
		const body = requestBody(request);
		const upstream = (activeSession: BffSession | null) =>
			fetch(
				`${upstreamUrl.replace(/\/$/, "")}/api/v1/${path}${currentUrl.search}`,
				upstreamRequestInit(request, activeSession, body),
			);
		let response = await upstream(session);
		if (
			response.status === 401 &&
			session &&
			refreshSession &&
			!isReadableStream(body)
		) {
			if (!(await refresh())) return { kind: "unauthenticated" };
			response = await upstream(session);
		}
		const contentType = response.headers.get("content-type");
		return {
			body: new Uint8Array(await response.arrayBuffer()),
			headers: contentType ? { "content-type": contentType } : {},
			kind: "response",
			status: response.status,
		};
	} catch {
		return { kind: "unreachable" };
	}
}
