import { useEffect, useRef } from "hono/jsx/dom";
import { targetValue } from "../../../lib/dom-events";
import { type LiveText, LiveTranscript } from "./LiveTranscript";

interface Props {
	finalText: string;
	live: LiveText | null;
	copied: boolean;
	deliveryNotice: string | null;
	resultCount: number;
	onCopy: () => void;
	onClear: () => void;
	onEdit: (text: string) => void;
}

export function TranscriptView({
	finalText,
	live,
	copied,
	deliveryNotice,
	resultCount,
	onCopy,
	onClear,
	onEdit,
}: Props) {
	const field = useRef<HTMLTextAreaElement>(null);

	// Each new result lands at the end; show it instead of the oldest lines.
	useEffect(() => {
		const transcript = field.current;
		if (transcript && resultCount > 0)
			transcript.scrollTop = transcript.scrollHeight;
	}, [resultCount]);

	function clear() {
		const transcript = field.current;
		if (transcript) {
			transcript.focus();
			transcript.select();
			// Deleting through the editing commands lets Ctrl+Z bring the text back.
			if (document.execCommand("delete")) return;
		}
		onClear();
		transcript?.focus();
	}

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
							<button type="button" class="btn btn-ghost" onClick={clear}>
								Clear
							</button>
						</>
					)}
				</div>
			</div>
			<textarea
				aria-label="Transcript"
				class="transcript-text"
				onChange={(event) => onEdit(targetValue(event))}
				placeholder="Your dictation appears here. You can type or edit it."
				ref={field}
				value={finalText}
			/>
			{live && <LiveTranscript {...live} />}
		</div>
	);
}
