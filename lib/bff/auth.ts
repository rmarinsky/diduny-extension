import { isValidEmail, isValidOtp } from "../../src/core/auth-validation";
import { bffFetch } from "./client";

export interface BffAuthSession {
	authenticated: boolean;
	email?: string;
}

async function errorMessage(response: Response) {
	const body = (await response.json().catch(() => null)) as {
		error?: unknown;
	} | null;
	return typeof body?.error === "string"
		? body.error
		: `Request failed (${response.status})`;
}

async function expectOk(response: Response) {
	if (response.ok) return response;
	throw new Error(await errorMessage(response));
}

export async function getBffAuthSession(): Promise<BffAuthSession> {
	const response = await expectOk(
		await bffFetch("/bff/extension/auth/session"),
	);
	const body = (await response.json()) as BffAuthSession;
	return body.authenticated === true
		? { authenticated: true, ...(body.email ? { email: body.email } : {}) }
		: { authenticated: false };
}

export async function sendBffOtp(email: string): Promise<void> {
	if (!isValidEmail(email)) throw new Error("Invalid email");
	await expectOk(
		await bffFetch("/bff/auth/send-otp", {
			body: JSON.stringify({ email }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
}

export async function verifyBffOtp(
	email: string,
	otp: string,
): Promise<{ email: string }> {
	if (!isValidEmail(email) || !isValidOtp(otp))
		throw new Error("Invalid one-time code");
	const response = await expectOk(
		await bffFetch("/bff/auth/verify-otp", {
			body: JSON.stringify({ email, otp }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	const body = (await response.json()) as { email?: unknown };
	return { email: typeof body.email === "string" ? body.email : email };
}

export async function logoutBff(): Promise<void> {
	await expectOk(
		await bffFetch("/bff/extension/auth/logout", { method: "POST" }),
	);
}
