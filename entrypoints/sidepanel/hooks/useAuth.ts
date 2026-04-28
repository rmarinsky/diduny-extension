/**
 * useAuth — side panel auth hook.
 *
 * Per ADR-0005: all Supabase calls go through the background SW, which holds
 * the sole Supabase client instance with the chrome.storage.local adapter.
 * Side panel never imports supabase directly.
 *
 * Auth state is derived by asking the SW for the current session on mount.
 */
import { useCallback, useEffect, useState } from "react";
import { crashLog } from "../../../lib/crash-log";

type AuthStep = "email" | "otp" | "authenticated";

interface AuthUser {
	id: string;
	email: string | undefined;
}

function sendToBackground<T>(msg: Record<string, unknown>): Promise<T> {
	return new Promise((resolve, reject) => {
		chrome.runtime.sendMessage(msg, (response) => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
				return;
			}
			resolve(response as T);
		});
	});
}

export function useAuth() {
	const [step, setStep] = useState<AuthStep>("email");
	const [email, setEmail] = useState("");
	const [user, setUser] = useState<AuthUser | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Check existing session on mount by querying SW
	useEffect(() => {
		sendToBackground<{ token: string; expires_at: number } | { error: string }>(
			{ type: "getAccessToken" },
		)
			.then((res) => {
				if ("token" in res) {
					// Session exists — fetch user details via getAccessToken response
					// (user info is in the session stored in chrome.storage.local)
					// We use a secondary message to get the user object.
					return sendToBackground<{
						ok: boolean;
						user?: { id: string; email: string };
					}>({ type: "getSessionUser" }).then((userRes) => {
						if (userRes.ok && userRes.user) {
							setUser({ id: userRes.user.id, email: userRes.user.email });
							setStep("authenticated");
						}
					});
				}
			})
			.catch(() => {
				// No session or SW not yet awake — stay on email step
			})
			.finally(() => setLoading(false));
	}, []);

	const requestOtp = useCallback(async (emailInput: string) => {
		crashLog("sidepanel:auth", "info", `requestOtp for ${emailInput}`);
		setLoading(true);
		setError(null);
		try {
			const res = await sendToBackground<{ ok: boolean; error?: string }>({
				type: "signInRequest",
				email: emailInput,
			});
			if (!res.ok) throw new Error(res.error ?? "Failed to send OTP");
			setEmail(emailInput);
			setStep("otp");
		} catch (err) {
			crashLog(
				"sidepanel:auth",
				"error",
				`requestOtp failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			setError(err instanceof Error ? err.message : "Failed to send OTP");
		} finally {
			setLoading(false);
		}
	}, []);

	const submitOtp = useCallback(
		async (otp: string) => {
			crashLog("sidepanel:auth", "info", "verifyOtp");
			setLoading(true);
			setError(null);
			try {
				const res = await sendToBackground<{
					ok: boolean;
					error?: string;
					user?: { id: string; email: string };
				}>({
					type: "verifyOtpRequest",
					email,
					token: otp,
				});
				if (!res.ok) throw new Error(res.error ?? "Invalid OTP");
				setUser(res.user ? { id: res.user.id, email: res.user.email } : null);
				setStep("authenticated");
				crashLog("sidepanel:auth", "info", "authenticated");
			} catch (err) {
				crashLog(
					"sidepanel:auth",
					"error",
					`verifyOtp failed: ${err instanceof Error ? err.message : String(err)}`,
				);
				setError(err instanceof Error ? err.message : "Invalid OTP");
			} finally {
				setLoading(false);
			}
		},
		[email],
	);

	const logout = useCallback(async () => {
		crashLog("sidepanel:auth", "info", "logout");
		setLoading(true);
		try {
			await sendToBackground<{ ok: boolean }>({ type: "signOutRequest" });
		} finally {
			setUser(null);
			setEmail("");
			setStep("email");
			setLoading(false);
		}
	}, []);

	return { step, email, user, loading, error, requestOtp, submitOtp, logout };
}
