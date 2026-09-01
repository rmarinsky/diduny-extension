import { HTTP } from "./constants";
import type { ClockPort, HttpPort, HttpRequest, HttpResponse } from "./ports";

export interface SessionTokens {
	accessToken: string;
	email: string;
	expiresAt: number;
	refreshToken: string;
}

function completeSessionTokens(
	value: SessionTokens | null,
): value is SessionTokens {
	return Boolean(
		value &&
			typeof value.accessToken === "string" &&
			value.accessToken &&
			typeof value.email === "string" &&
			value.email &&
			typeof value.expiresAt === "number" &&
			Number.isFinite(value.expiresAt) &&
			typeof value.refreshToken === "string" &&
			value.refreshToken,
	);
}

export interface TokenStore {
	clear(): Promise<void>;
	read(): Promise<SessionTokens | null>;
	write(tokens: SessionTokens): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
	constructor(private value: SessionTokens | null = null) {}

	async clear() {
		this.value = null;
	}

	async read() {
		return this.value;
	}

	async write(tokens: SessionTokens) {
		this.value = tokens;
	}
}

export class ProxyApiError extends Error {
	constructor(
		readonly endpoint: string,
		message: string,
	) {
		super(message);
		this.name = "ProxyApiError";
	}
}

export class AuthenticationError extends ProxyApiError {
	constructor(endpoint: string) {
		super(endpoint, `Authentication failed for ${endpoint}`);
		this.name = "AuthenticationError";
	}
}

export class DecodeError extends ProxyApiError {
	constructor(endpoint: string, field: string) {
		super(endpoint, `Invalid ${field} response from ${endpoint}`);
		this.name = "DecodeError";
	}
}

export class UsageLimitError extends ProxyApiError {
	constructor(
		endpoint: string,
		readonly usedHours: number,
		readonly limitHours: number,
	) {
		super(endpoint, "Usage limit exceeded");
		this.name = "UsageLimitError";
	}
}

export interface Usage {
	isWhitelisted: boolean;
	limitHours?: number;
	remainingHours?: number;
	usedHours: number;
	usedMs: number;
}

export interface TranscriptToken {
	endMs: number;
	speaker?: string;
	startMs: number;
	text: string;
}

export interface TranscriptResult {
	text: string;
	tokens: readonly TranscriptToken[];
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown, endpoint: string, field: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new DecodeError(endpoint, field);
	}
	return value as JsonRecord;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asSpeaker(value: unknown): string | undefined {
	return asString(value) ?? asNumber(value)?.toString();
}

function milliseconds(value: unknown, secondsValue: unknown) {
	return asNumber(value) ?? (asNumber(secondsValue) ?? 0) * 1000;
}

function parseJson(response: HttpResponse, endpoint: string): unknown {
	try {
		return JSON.parse(new TextDecoder().decode(response.body));
	} catch {
		throw new DecodeError(endpoint, "JSON");
	}
}

function decodeTokens(value: unknown): readonly TranscriptToken[] {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => {
		const token = asRecord(entry, "transcript", "token");
		const text = asString(token.text);
		if (!text) throw new DecodeError("transcript", "token.text");
		return {
			endMs: milliseconds(
				token.end_ms ?? token.endMs,
				token.end_seconds ?? token.endSeconds ?? token.end,
			),
			speaker: asSpeaker(
				token.speaker ?? token.speaker_id ?? token.speaker_index,
			),
			startMs: milliseconds(
				token.start_ms ?? token.startMs,
				token.start_seconds ?? token.startSeconds ?? token.start,
			),
			text,
		};
	});
}

export function decodeTranscriptResult(value: unknown): TranscriptResult {
	const result = asRecord(value, "transcript", "response");
	const text = asString(result.text ?? result.transcript);
	if (text === undefined) throw new DecodeError("transcript", "text");
	return {
		text,
		tokens: decodeTokens(result.tokens ?? result.words ?? result.segments),
	};
}

function decodeTokensResponse(value: unknown, endpoint: string): SessionTokens {
	const response = asRecord(value, endpoint, "token");
	const accessToken = asString(response.accessToken);
	const refreshToken = asString(response.refreshToken);
	const expiresAt = asNumber(response.accessTokenExpiresAt);
	if (!accessToken || !refreshToken || expiresAt === undefined) {
		throw new DecodeError(endpoint, "token");
	}
	const user =
		response.user && typeof response.user === "object"
			? response.user
			: undefined;
	return {
		accessToken,
		email: asString((user as JsonRecord | undefined)?.email) ?? "",
		expiresAt,
		refreshToken,
	};
}

function usageError(response: HttpResponse, endpoint: string) {
	try {
		const body = asRecord(
			parseJson(response, endpoint),
			endpoint,
			"usage limit",
		);
		return new UsageLimitError(
			endpoint,
			asNumber(body.usedHours) ?? 0,
			asNumber(body.limitHours) ?? 0,
		);
	} catch {
		return new UsageLimitError(endpoint, 0, 0);
	}
}

export class ProxyApiClient {
	private refreshTask: Promise<SessionTokens> | null = null;

	constructor(
		private readonly dependencies: {
			clock: ClockPort;
			http: HttpPort;
			tokens: TokenStore;
		},
	) {}

	async usage(): Promise<Usage> {
		const response = await this.authorized({
			method: "GET",
			path: "/api/v1/usage/me",
		});
		const body = asRecord(
			parseJson(response, "/api/v1/usage/me"),
			"/api/v1/usage/me",
			"usage",
		);
		const isWhitelisted = body.isWhitelisted;
		const usedHours = asNumber(body.usedHours);
		const usedMs = asNumber(body.usedMs);
		if (
			typeof isWhitelisted !== "boolean" ||
			usedHours === undefined ||
			usedMs === undefined
		) {
			throw new DecodeError("/api/v1/usage/me", "usage");
		}
		return {
			isWhitelisted,
			limitHours: asNumber(body.limitHours),
			remainingHours: asNumber(body.remainingHours),
			usedHours,
			usedMs,
		};
	}

	async logout() {
		await this.refreshTask?.catch(() => undefined);
		const tokens = await this.dependencies.tokens.read();
		await this.dependencies.tokens.clear();
		if (!tokens) return;
		await this.dependencies.http
			.send({
				headers: { Authorization: `Bearer ${tokens.accessToken}` },
				method: "POST",
				path: "/api/v1/auth/logout",
			})
			.catch(() => undefined);
	}

	private async authorized(request: HttpRequest): Promise<HttpResponse> {
		const tokens = await this.currentTokens();
		const first = await this.sendAuthorized(request, tokens.accessToken);
		if (first.status !== 401) return this.requireSuccess(first, request.path);

		const refreshed = await this.refreshIfUnchanged(tokens.accessToken);
		const retry = await this.sendAuthorized(request, refreshed.accessToken);
		if (retry.status === 401) throw new AuthenticationError(request.path);
		return this.requireSuccess(retry, request.path);
	}

	private async currentTokens(): Promise<SessionTokens> {
		const tokens = await this.dependencies.tokens.read();
		if (!completeSessionTokens(tokens)) {
			await this.dependencies.tokens.clear();
			throw new AuthenticationError("session");
		}
		if (
			tokens.expiresAt - this.dependencies.clock.now() <=
			HTTP.proactiveRefreshLeadMs
		) {
			return this.refreshIfUnchanged(tokens.accessToken);
		}
		return tokens;
	}

	private async refreshIfUnchanged(
		accessToken: string,
	): Promise<SessionTokens> {
		const current = await this.dependencies.tokens.read();
		if (!current || current.accessToken !== accessToken) {
			if (!current) throw new AuthenticationError("session");
			return current;
		}
		return this.refresh();
	}

	private async refresh(): Promise<SessionTokens> {
		if (this.refreshTask) return this.refreshTask;
		const task = this.performRefresh();
		this.refreshTask = task;
		try {
			return await task;
		} finally {
			if (this.refreshTask === task) this.refreshTask = null;
		}
	}

	private async performRefresh(): Promise<SessionTokens> {
		const current = await this.dependencies.tokens.read();
		if (!completeSessionTokens(current)) {
			await this.dependencies.tokens.clear();
			throw new AuthenticationError("session");
		}
		const endpoint = "/api/v1/auth/refresh";
		const response = await this.dependencies.http.send({
			body: JSON.stringify({ refreshToken: current.refreshToken }),
			headers: { "Content-Type": "application/json" },
			method: "POST",
			path: endpoint,
		});
		if (response.status < 200 || response.status >= 300) {
			await this.dependencies.tokens.clear();
			throw new AuthenticationError(endpoint);
		}
		try {
			const decoded = decodeTokensResponse(
				parseJson(response, endpoint),
				endpoint,
			);
			const tokens = { ...decoded, email: decoded.email || current.email };
			await this.dependencies.tokens.write(tokens);
			return tokens;
		} catch (error) {
			await this.dependencies.tokens.clear();
			throw error;
		}
	}

	private async sendAuthorized(request: HttpRequest, accessToken: string) {
		return this.dependencies.http.send({
			...request,
			headers: { ...request.headers, Authorization: `Bearer ${accessToken}` },
		});
	}

	private requireSuccess(response: HttpResponse, endpoint: string) {
		if (response.status === 402) throw usageError(response, endpoint);
		if (response.status < 200 || response.status >= 300) {
			throw new ProxyApiError(
				endpoint,
				`Request failed with ${response.status}`,
			);
		}
		return response;
	}
}
