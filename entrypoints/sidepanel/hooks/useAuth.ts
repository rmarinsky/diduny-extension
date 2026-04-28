import { useCallback, useEffect, useState } from "react";
import { sendOtp, verifyOtp } from "../../../lib/api/auth";
import {
	clearTokens,
	getTokens,
	saveTokens,
} from "../../../lib/auth/token-manager";
import { crashLog } from "../../../lib/crash-log";
import type { AuthTokens } from "../../../lib/types";

type AuthStep = "email" | "otp" | "authenticated";

export function useAuth() {
	const [step, setStep] = useState<AuthStep>("email");
	const [email, setEmail] = useState("");
	const [user, setUser] = useState<AuthTokens["user"] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Check existing session on mount
	useEffect(() => {
		getTokens().then((tokens) => {
			if (tokens) {
				setUser(tokens.user);
				setStep("authenticated");
			}
		});
	}, []);

	const requestOtp = useCallback(async (emailInput: string) => {
		crashLog("sidepanel:auth", "info", `requestOtp for ${emailInput}`);
		setLoading(true);
		setError(null);
		try {
			await sendOtp(emailInput);
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
				const tokens = await verifyOtp(email, otp);
				await saveTokens(tokens);
				setUser(tokens.user);
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
		await clearTokens();
		setUser(null);
		setEmail("");
		setStep("email");
	}, []);

	return { step, email, user, loading, error, requestOtp, submitOtp, logout };
}
