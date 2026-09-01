/**
 * useAuth — side panel auth hook.
 *
 * All authentication calls go through the BFF. The side panel receives only
 * the authenticated email and never persists upstream credentials.
 *
 * Auth state is derived by asking the SW for the current session on mount.
 */
import { useCallback, useEffect, useState } from "react";
import { crashLog } from "../../../lib/crash-log";

type AuthStep = "unauthenticated" | "authenticated";

interface AuthUser {
	email: string;
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
	const [step, setStep] = useState<AuthStep>("unauthenticated");
	const [user, setUser] = useState<AuthUser | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Check the BFF-owned session on mount.
	useEffect(() => {
		sendToBackground<{ authenticated: boolean; email?: string }>({
			type: "getBffSession",
		})
			.then((res) => {
				if (res.authenticated && res.email) {
					setUser({ email: res.email });
					setStep("authenticated");
				}
			})
			.catch(() => {
				// No session or SW not yet awake — stay on email step
			})
			.finally(() => setLoading(false));
	}, []);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await sendToBackground<{
				authenticated: boolean;
				email?: string;
			}>({ type: "getBffSession" });
			if (res.authenticated && res.email) {
				setUser({ email: res.email });
				setStep("authenticated");
			} else {
				setStep("unauthenticated");
			}
		} catch (err) {
			crashLog(
				"sidepanel:auth",
				"error",
				err instanceof Error ? err.message : "Could not refresh session",
			);
			setError("Could not check the Diduny session");
		} finally {
			setLoading(false);
		}
	}, []);

	const openBffSignIn = useCallback(async () => {
		setError(null);
		const result = await sendToBackground<{ ok: boolean; error?: string }>({
			type: "openBffSignIn",
		});
		if (!result.ok) setError(result.error ?? "Could not open Diduny");
	}, []);

	const logout = useCallback(async () => {
		crashLog("sidepanel:auth", "info", "logout");
		setLoading(true);
		try {
			await sendToBackground<{ ok: boolean }>({ type: "signOutRequest" });
		} finally {
			setUser(null);
			setStep("unauthenticated");
			setLoading(false);
		}
	}, []);

	return { step, user, loading, error, refresh, openBffSignIn, logout };
}
