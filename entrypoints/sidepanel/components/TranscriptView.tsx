interface Props {
	finalText: string;
	interimText: string;
	copied: boolean;
	onCopy: () => void;
	onClear: () => void;
}

export function TranscriptView({
	finalText,
	interimText,
	copied,
	onCopy,
	onClear,
}: Props) {
	const hasText = finalText || interimText;
	if (!hasText) return null;

	return (
		<div className="transcript">
			<div className="transcript-header">
				<h3>Transcript</h3>
				<div>
					{finalText && (
						<>
							<button type="button" className="btn btn-ghost" onClick={onCopy}>
								{copied ? "Copied!" : "Copy"}
							</button>
							<button type="button" className="btn btn-ghost" onClick={onClear}>
								Clear
							</button>
						</>
					)}
				</div>
			</div>
			<div className="transcript-text">
				{finalText}
				{interimText && <span className="interim">{interimText}</span>}
			</div>
		</div>
	);
}
