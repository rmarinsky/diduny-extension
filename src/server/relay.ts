import type { FastifyRequest } from "fastify";
import type { BffSession, SessionStore } from "./session-store";

const cookieName = "diduny_session";

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

function sessionIdFromCookie(cookie: string | undefined) {
	if (!cookie) return null;
	for (const part of cookie.split(";")) {
		const [name, value] = part.trim().split("=", 2);
		if (name === cookieName && value) return decodeURIComponent(value);
	}
	return null;
}

function requestBody(request: FastifyRequest) {
	if (request.method === "GET" || request.method === "HEAD") return undefined;
	if (typeof request.body === "string" || request.body instanceof Uint8Array) {
		return request.body;
	}
	return request.body === undefined ? undefined : JSON.stringify(request.body);
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
	fetch,
	request,
	sessions,
	upstreamUrl,
}: {
	fetch: typeof globalThis.fetch;
	request: FastifyRequest;
	sessions: SessionStore;
	upstreamUrl: string;
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
	if (requiresSession(path)) {
		const sessionId = sessionIdFromCookie(request.headers.cookie);
		session = sessionId ? await sessions.get(sessionId) : null;
		if (!session) return { kind: "unauthenticated" };
	}

	const currentUrl = new URL(request.raw.url ?? "", "http://bff.local");
	try {
		const response = await fetch(
			`${upstreamUrl.replace(/\/$/, "")}/api/v1/${path}${currentUrl.search}`,
			{
				body: requestBody(request) as BodyInit | undefined,
				headers: requestHeaders(request, session),
				method: request.method,
			},
		);
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
