export interface LiveText {
	final: string;
	provisional: string;
}

/** What the current recording streams; the transcript only gets the finished result. */
export function LiveTranscript({ final, provisional }: LiveText) {
	return (
		<section aria-label="Live transcript" className="live-transcript">
			<h3>Live transcript</h3>
			<p className="live-final">
				<span className="token-state">Final</span>
				<span data-testid="live-final-text">{final}</span>
			</p>
			<p aria-hidden="true" className="live-provisional">
				<span className="token-state">Provisional</span>
				<span data-testid="live-provisional-text">{provisional}</span>
			</p>
		</section>
	);
}
