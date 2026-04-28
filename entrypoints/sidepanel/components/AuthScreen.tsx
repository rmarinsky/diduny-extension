import { type FormEvent, useState } from "react";

interface Props {
	step: "email" | "otp";
	loading: boolean;
	error: string | null;
	onSendOtp: (email: string) => void;
	onVerifyOtp: (otp: string) => void;
}

export function AuthScreen({
	step,
	loading,
	error,
	onSendOtp,
	onVerifyOtp,
}: Props) {
	const [email, setEmail] = useState("");
	const [otp, setOtp] = useState("");

	const handleEmailSubmit = (e: FormEvent) => {
		e.preventDefault();
		if (email.trim()) onSendOtp(email.trim());
	};

	const handleOtpSubmit = (e: FormEvent) => {
		e.preventDefault();
		if (otp.trim()) onVerifyOtp(otp.trim());
	};

	return (
		<div className="auth-screen">
			<h2>Diduny</h2>
			<p>Voice dictation & meeting recording</p>

			{step === "email" ? (
				<form onSubmit={handleEmailSubmit} className="input-group">
					<input
						type="email"
						placeholder="Email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						disabled={loading}
					/>
					<button
						type="submit"
						className="btn btn-primary"
						disabled={loading || !email.trim()}
					>
						{loading ? "..." : "Send OTP"}
					</button>
				</form>
			) : (
				<form onSubmit={handleOtpSubmit} className="input-group">
					<input
						type="text"
						placeholder="Enter 6-digit code"
						value={otp}
						onChange={(e) => setOtp(e.target.value)}
						maxLength={6}
						disabled={loading}
					/>
					<button
						type="submit"
						className="btn btn-primary"
						disabled={loading || otp.length < 6}
					>
						{loading ? "..." : "Verify"}
					</button>
				</form>
			)}

			{error && <div className="error-msg">{error}</div>}
		</div>
	);
}
