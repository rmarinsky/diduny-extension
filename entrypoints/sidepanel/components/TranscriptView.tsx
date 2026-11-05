interface Props {
	finalText: string;
	interimText: string;
	copied: boolean;
	deliveryNotice: string | null;
	onCopy: () => void;
	onClear: () => void;
}

export function TranscriptView({
	finalText,
	interimText,
	copied,
	deliveryNotice,
	onCopy,
	onClear,
}: Props) {
	const hasText = finalText || interimText;
	if (!hasText) return null;

	return (
		<div class="transcript">
			{deliveryNotice && <p class="delivery-notice">{deliveryNotice}</p>}
			<div class="transcript-header">
				<h3>Transcript</h3>
				<div>
					{finalText && (
						<>
							<button type="button" class="btn btn-ghost" onClick={onCopy}>
								{copied ? "Copied!" : "Copy"}
							</button>
							<button type="button" class="btn btn-ghost" onClick={onClear}>
								Clear
							</button>
						</>
					)}
				</div>
			</div>
			<div class="transcript-text">
				{finalText}
				{interimText && <span class="interim">{interimText}</span>}
			</div>
		</div>
	);
}
