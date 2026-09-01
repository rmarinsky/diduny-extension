import { TIME } from "../core/constants";
import type { BffSession } from "./session-store";

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: null;
}

function string(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

export interface BffAuthGateway {
	logout(session: BffSession): Promise<void>;
	refresh(session: BffSession): Promise<BffSession>;
	sendOtp(email: string): Promise<void>;
	verifyOtp(email: string, otp: string): Promise<BffSession>;
}

export class ProxyOtpGateway implements BffAuthGateway {
	constructor(
		private readonly fetch: typeof globalThis.fetch,
		private readonly upstreamUrl: string,
	) {}

	async logout(session: BffSession) {
		await this.request("logout", {
			headers: { authorization: `Bearer ${session.accessToken}` },
			method: "POST",
		});
	}

	async sendOtp(email: string) {
		await this.request("send-otp", {
			body: JSON.stringify({ email }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
	}

	async refresh(session: BffSession) {
		if (!session.refreshToken) throw new Error("session has no refresh token");
		const response = await this.request("refresh", {
			body: JSON.stringify({ refreshToken: session.refreshToken }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		return decodeProxySession(await response.json(), session.email ?? "");
	}

	async verifyOtp(email: string, otp: string) {
		const response = await this.request("verify-otp", {
			body: JSON.stringify({ email, otp }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		return decodeProxySession(await response.json(), email);
	}

	private async request(path: string, init: RequestInit) {
		const response = await this.fetch(
			`${this.upstreamUrl.replace(/\/$/, "")}/api/v1/auth/${path}`,
			init,
		);
		if (response.status < 200 || response.status >= 300) {
			throw new Error(`Upstream auth failed with ${response.status}`);
		}
		return response;
	}
}

export class SupabaseOtpGateway implements BffAuthGateway {
	constructor(
		private readonly fetch: typeof globalThis.fetch,
		private readonly supabaseUrl: string,
		private readonly publishableKey: string,
	) {}

	async logout(session: BffSession) {
		await this.fetch(`${this.baseUrl}/auth/v1/logout`, {
			headers: {
				apikey: this.publishableKey,
				authorization: `Bearer ${session.accessToken}`,
			},
			method: "POST",
		});
	}

	async sendOtp(email: string) {
		await this.request("otp", { email });
	}

	async refresh(session: BffSession) {
		if (!session.refreshToken) throw new Error("session has no refresh token");
		const response = await this.request("token?grant_type=refresh_token", {
			refresh_token: session.refreshToken,
		});
		return decodeSupabaseSession(await response.json(), session.email ?? "");
	}

	async verifyOtp(email: string, otp: string) {
		const response = await this.request("verify", {
			email,
			token: otp,
			type: "email",
		});
		return decodeSupabaseSession(await response.json(), email);
	}

	private get baseUrl() {
		return this.supabaseUrl.replace(/\/$/, "");
	}

	private async request(path: string, body: Record<string, string>) {
		const response = await this.fetch(`${this.baseUrl}/auth/v1/${path}`, {
			body: JSON.stringify(body),
			headers: {
				apikey: this.publishableKey,
				authorization: `Bearer ${this.publishableKey}`,
				"content-type": "application/json",
			},
			method: "POST",
		});
		if (response.status < 200 || response.status >= 300) {
			throw new Error(`Supabase auth failed with ${response.status}`);
		}
		return response;
	}
}

function decodeProxySession(value: unknown, fallbackEmail: string): BffSession {
	const body = object(value);
	const accessToken = string(body?.accessToken);
	const refreshToken = string(body?.refreshToken);
	const expiresAt = body?.accessTokenExpiresAt;
	const user = object(body?.user);
	if (
		!accessToken ||
		!refreshToken ||
		typeof expiresAt !== "number" ||
		!Number.isFinite(expiresAt)
	) {
		throw new Error("invalid proxy auth response");
	}
	return {
		accessToken,
		email: string(user?.email) ?? fallbackEmail,
		expiresAt,
		refreshToken,
	};
}

function decodeSupabaseSession(
	value: unknown,
	fallbackEmail: string,
): BffSession {
	const body = object(value);
	const accessToken = string(body?.access_token);
	const refreshToken = string(body?.refresh_token);
	const expiresAt = body?.expires_at;
	const user = object(body?.user);
	if (
		!accessToken ||
		!refreshToken ||
		typeof expiresAt !== "number" ||
		!Number.isFinite(expiresAt)
	) {
		throw new Error("invalid Supabase auth response");
	}
	return {
		accessToken,
		email: string(user?.email) ?? fallbackEmail,
		expiresAt: expiresAt * TIME.millisecondsPerSecond,
		refreshToken,
	};
}
