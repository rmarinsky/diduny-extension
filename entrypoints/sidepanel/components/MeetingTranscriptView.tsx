import { useEffect, useRef, useState } from "react";
import { type LiveText, LiveTranscript } from "./LiveTranscript";

interface SourceProps {
	label: string;
	finalText: string;
	resultCount: number;
}

function SourcePanel({ label, finalText, resultCount }: SourceProps) {
	const text = useRef<HTMLDivElement>(null);

	// Each new result lands at the end; show it instead of the oldest lines.
	useEffect(() => {
		if (text.current && resultCount > 0)
			text.current.scrollTop = text.current.scrollHeight;
	}, [resultCount]);

	if (!finalText) return null;

	return (
		<div className="source-panel">
			<div className="source-label">{label}</div>
			<div className="transcript-text" ref={text}>
				{finalText}
			</div>
		</div>
	);
}

interface Props {
	tabText: string;
	micText: string;
	live: LiveText | null;
	copied: boolean;
	resultCount: number;
	onCopy: () => void;
	onClear: () => void;
}

export function MeetingTranscriptView({
	tabText,
	micText,
	live,
	copied,
	resultCount,
	onCopy,
	onClear,
}: Props) {
	// The meeting text is not editable, so Ctrl+Z cannot undo a Clear; ask first.
	const [confirmingClear, setConfirmingClear] = useState(false);
	const hasText = tabText || micText;
	if (!hasText && !live) return null;

	return (
		<div className="transcript">
			{hasText && (
				<>
					<div className="transcript-header">
						<h3>Meeting Transcript</h3>
						<div>
							<button type="button" className="btn btn-ghost" onClick={onCopy}>
								{copied ? "Copied!" : "Copy all"}
							</button>
							{confirmingClear ? (
								<>
									<span className="confirm-text">
										Clear the meeting transcript?
									</span>
									<button
										type="button"
										className="btn btn-ghost"
										onClick={() => {
											setConfirmingClear(false);
											onClear();
										}}
									>
										Clear
									</button>
									<button
										type="button"
										className="btn btn-ghost"
										onClick={() => setConfirmingClear(false)}
									>
										Cancel
									</button>
								</>
							) : (
								<button
									type="button"
									className="btn btn-ghost"
									onClick={() => setConfirmingClear(true)}
								>
									Clear
								</button>
							)}
						</div>
					</div>
					<div className="meeting-sources">
						<SourcePanel
							label="Shared Audio"
							finalText={tabText}
							resultCount={resultCount}
						/>
						<SourcePanel
							label="Microphone"
							finalText={micText}
							resultCount={resultCount}
						/>
					</div>
				</>
			)}
			{live && <LiveTranscript {...live} />}
		</div>
	);
}
