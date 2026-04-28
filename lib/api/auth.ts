import type { AuthTokens } from "../types";
import { apiFetch } from "./client";

export async function sendOtp(email: string): Promise<void> {
	await apiFetch("/api/v1/auth/send-otp", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email }),
		skipAuth: true,
	});
}

export async function verifyOtp(
	email: string,
	otp: string,
): Promise<AuthTokens> {
	const res = await apiFetch("/api/v1/auth/verify-otp", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, otp }),
		skipAuth: true,
	});
	return res.json();
}

export async function refreshToken(
	refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
	const res = await apiFetch("/api/v1/auth/refresh", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ refreshToken }),
		skipAuth: true,
	});
	return res.json();
}
