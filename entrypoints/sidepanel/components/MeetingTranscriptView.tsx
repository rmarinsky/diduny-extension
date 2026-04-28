interface SourceProps {
	label: string;
	finalText: string;
	interimText: string;
}

function SourcePanel({ label, finalText, interimText }: SourceProps) {
	if (!finalText && !interimText) return null;

	return (
		<div className="source-panel">
			<div className="source-label">{label}</div>
			<div className="transcript-text">
				{finalText}
				{interimText && <span className="interim">{interimText}</span>}
			</div>
		</div>
	);
}

interface Props {
	tab: { finalText: string; interimText: string };
	mic: { finalText: string; interimText: string };
	copied: boolean;
	onCopy: () => void;
	onClear: () => void;
}

export function MeetingTranscriptView({
	tab,
	mic,
	copied,
	onCopy,
	onClear,
}: Props) {
	const hasText =
		tab.finalText || tab.interimText || mic.finalText || mic.interimText;
	if (!hasText) return null;

	return (
		<div className="transcript">
			<div className="transcript-header">
				<h3>Meeting Transcript</h3>
				<div>
					<button type="button" className="btn btn-ghost" onClick={onCopy}>
						{copied ? "Copied!" : "Copy all"}
					</button>
					<button type="button" className="btn btn-ghost" onClick={onClear}>
						Clear
					</button>
				</div>
			</div>
			<div className="meeting-sources">
				<SourcePanel
					label="Shared Audio"
					finalText={tab.finalText}
					interimText={tab.interimText}
				/>
				<SourcePanel
					label="Microphone"
					finalText={mic.finalText}
					interimText={mic.interimText}
				/>
			</div>
		</div>
	);
}
