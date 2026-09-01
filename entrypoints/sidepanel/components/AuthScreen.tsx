interface Props {
	loading: boolean;
	error: string | null;
	onOpenSignIn: () => void;
	onRefresh: () => void;
}

export function AuthScreen({ loading, error, onOpenSignIn, onRefresh }: Props) {
	return (
		<div className="auth-screen">
			<h2>Diduny</h2>
			<p>Voice dictation & meeting recording</p>
			<button
				type="button"
				className="btn btn-ghost"
				onClick={() => void chrome.runtime.openOptionsPage()}
			>
				BFF settings
			</button>

			<p>Sign in in the Diduny web app, then return here.</p>
			<button
				type="button"
				className="btn btn-primary"
				onClick={onOpenSignIn}
				disabled={loading}
			>
				Open Diduny sign-in
			</button>
			<button
				type="button"
				className="btn btn-ghost"
				onClick={onRefresh}
				disabled={loading}
			>
				{loading ? "Checking..." : "I signed in"}
			</button>

			{error && <div className="error-msg">{error}</div>}
		</div>
	);
}
