import { useState } from "react";
import {
	type LogEntry,
	clearCrashLogs,
	getCrashLogs,
} from "../../../lib/crash-log";
import type { RecordingMode, RecordingState } from "../../../lib/types";

interface Props {
	state: RecordingState;
	mode: RecordingMode;
	language: string;
	translationTargetLanguage: string;
	diarization: boolean;
	userEmail: string;
	onToggleRecording: () => void;
	onModeChange: (mode: RecordingMode) => void;
	onLanguageChange: (lang: string) => void;
	onTranslationTargetLanguageChange: (lang: string) => void;
	onDiarizationChange: (val: boolean) => void;
	onLogout: () => void;
	error: string | null;
}

const stateLabels: Record<RecordingState, string> = {
	idle: "Ready",
	starting: "Starting...",
	recording: "Recording...",
	processing: "Processing...",
	success: "Done",
	error: "Error",
};

export function RecordingControls({
	state,
	mode,
	language,
	translationTargetLanguage,
	diarization,
	userEmail,
	onToggleRecording,
	onModeChange,
	onLanguageChange,
	onTranslationTargetLanguageChange,
	onDiarizationChange,
	onLogout,
	error,
}: Props) {
	const isRecording = state === "recording";
	const isStarting = state === "starting";
	const isProcessing = state === "processing";
	const canRecord = !isStarting && !isProcessing;
	const [logs, setLogs] = useState<LogEntry[] | null>(null);

	const toggleLogs = async () => {
		if (logs) {
			setLogs(null);
		} else {
			setLogs(await getCrashLogs());
		}
	};

	return (
		<div className="controls">
			<div className="controls-header">
				<span className="user-email">{userEmail}</span>
				<div>
					<button
						type="button"
						className="btn btn-ghost"
						onClick={() => void chrome.runtime.openOptionsPage()}
					>
						Settings
					</button>
					<button type="button" className="btn btn-ghost" onClick={toggleLogs}>
						Logs
					</button>
					<button type="button" className="btn btn-ghost" onClick={onLogout}>
						Logout
					</button>
				</div>
			</div>

			{logs && (
				<div className="crash-logs">
					<div className="crash-logs-header">
						<span>Logs ({logs.length})</span>
						<button
							type="button"
							className="btn btn-ghost"
							onClick={() => {
								clearCrashLogs();
								setLogs([]);
							}}
						>
							Clear
						</button>
					</div>
					<div className="crash-logs-list">
						{logs.length === 0 && (
							<div className="crash-log-empty">No logs</div>
						)}
						{logs.map((entry, i) => (
							<div
								key={`${entry.ts}-${i}`}
								className={`crash-log-entry ${entry.level}`}
							>
								<div className="crash-log-meta">
									<span className="crash-log-time">
										{entry.ts.slice(11, 19)}
									</span>
									<span className="crash-log-ctx">{entry.ctx}</span>
								</div>
								<div className="crash-log-msg">{entry.msg}</div>
								{entry.stack && (
									<pre className="crash-log-stack">{entry.stack}</pre>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			<div className="mode-toggle">
				<button
					type="button"
					className={mode === "translation" ? "active" : ""}
					onClick={() => onModeChange("translation")}
					disabled={isRecording || isStarting || isProcessing}
				>
					Translate
				</button>
				<button
					type="button"
					className={mode === "voice" ? "active" : ""}
					onClick={() => onModeChange("voice")}
					disabled={isRecording || isStarting || isProcessing}
				>
					Voice
				</button>
				<button
					type="button"
					className={mode === "meeting" ? "active" : ""}
					onClick={() => onModeChange("meeting")}
					disabled={isRecording || isStarting || isProcessing}
				>
					Meeting
				</button>
			</div>

			<div className="settings-row">
				<select
					value={language}
					onChange={(e) => onLanguageChange(e.target.value)}
					disabled={isRecording || isStarting || isProcessing}
				>
					<option value="uk">Ukrainian</option>
					<option value="en">English</option>
					<option value="uk,en">UK + EN</option>
				</select>

				{mode === "translation" && (
					<label>
						To
						<select
							value={translationTargetLanguage}
							onChange={(e) =>
								onTranslationTargetLanguageChange(e.target.value)
							}
							disabled={isRecording || isStarting || isProcessing}
						>
							<option value="en">English</option>
							<option value="uk">Ukrainian</option>
						</select>
					</label>
				)}

				{mode === "meeting" && (
					<label>
						<input
							type="checkbox"
							checked={diarization}
							onChange={(e) => onDiarizationChange(e.target.checked)}
							disabled={isRecording || isStarting || isProcessing}
						/>
						Speakers
					</label>
				)}
			</div>

			{mode === "meeting" && (
				<div className="hint-text">
					Records the current browser tab and your microphone. Native meeting
					apps and system audio are not available.
				</div>
			)}

			<button
				type="button"
				className={`record-btn ${isRecording ? "recording" : ""}`}
				onClick={onToggleRecording}
				disabled={!canRecord}
			>
				<span className="dot" />
			</button>

			<div className={`state-label ${state}`}>{stateLabels[state]}</div>

			{error && <div className="error-msg">{error}</div>}
		</div>
	);
}
