interface SourceProps {
	label: string;
	finalText: string;
	interimText: string;
}

function SourcePanel({ label, finalText, interimText }: SourceProps) {
	if (!finalText && !interimText) return null;

	return (
		<div class="source-panel">
			<div class="source-label">{label}</div>
			<div class="transcript-text">
				{finalText}
				{interimText && <span class="interim">{interimText}</span>}
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
		<div class="transcript">
			<div class="transcript-header">
				<h3>Meeting Transcript</h3>
				<div>
					<button type="button" class="btn btn-ghost" onClick={onCopy}>
						{copied ? "Copied!" : "Copy all"}
					</button>
					<button type="button" class="btn btn-ghost" onClick={onClear}>
						Clear
					</button>
				</div>
			</div>
			<div class="meeting-sources">
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
