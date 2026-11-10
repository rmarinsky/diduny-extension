import { useState } from "hono/jsx/dom";
import {
	type LogEntry,
	clearCrashLogs,
	getCrashLogs,
} from "../../../lib/crash-log";
import { targetChecked, targetValue } from "../../../lib/dom-events";
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
	waitingForMicrophone: boolean;
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
	waitingForMicrophone,
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
		<div class="controls">
			<div class="controls-header">
				<span class="user-email">{userEmail}</span>
				<div>
					<button
						type="button"
						class="btn btn-ghost"
						onClick={() => void chrome.runtime.openOptionsPage()}
					>
						Settings
					</button>
					<button type="button" class="btn btn-ghost" onClick={toggleLogs}>
						Logs
					</button>
					<button type="button" class="btn btn-ghost" onClick={onLogout}>
						Logout
					</button>
				</div>
			</div>

			{logs && (
				<div class="crash-logs">
					<div class="crash-logs-header">
						<span>Logs ({logs.length})</span>
						<button
							type="button"
							class="btn btn-ghost"
							onClick={() => {
								clearCrashLogs();
								setLogs([]);
							}}
						>
							Clear
						</button>
					</div>
					<div class="crash-logs-list">
						{logs.length === 0 && <div class="crash-log-empty">No logs</div>}
						{logs.map((entry, i) => (
							<div
								key={`${entry.ts}-${i}`}
								class={`crash-log-entry ${entry.level}`}
							>
								<div class="crash-log-meta">
									<span class="crash-log-time">{entry.ts.slice(11, 19)}</span>
									<span class="crash-log-ctx">{entry.ctx}</span>
								</div>
								<div class="crash-log-msg">{entry.msg}</div>
								{entry.stack && (
									<pre class="crash-log-stack">{entry.stack}</pre>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			<div class="mode-toggle">
				<button
					type="button"
					aria-pressed={mode === "translation" ? "true" : "false"}
					class={mode === "translation" ? "active" : ""}
					onClick={() => onModeChange("translation")}
					disabled={isRecording || isStarting || isProcessing}
				>
					Translate
				</button>
				<button
					type="button"
					aria-pressed={mode === "voice" ? "true" : "false"}
					class={mode === "voice" ? "active" : ""}
					onClick={() => onModeChange("voice")}
					disabled={isRecording || isStarting || isProcessing}
				>
					Voice
				</button>
				<button
					type="button"
					aria-pressed={mode === "meeting" ? "true" : "false"}
					class={mode === "meeting" ? "active" : ""}
					onClick={() => onModeChange("meeting")}
					disabled={isRecording || isStarting || isProcessing}
				>
					Meeting
				</button>
			</div>

			<div class="settings-row">
				<select
					aria-label="Spoken language"
					value={language}
					onChange={(e) => onLanguageChange(targetValue(e))}
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
								onTranslationTargetLanguageChange(targetValue(e))
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
							onChange={(e) => onDiarizationChange(targetChecked(e))}
							disabled={isRecording || isStarting || isProcessing}
						/>
						Speakers
					</label>
				)}
			</div>

			{mode === "meeting" && (
				<div class="hint-text">
					Records the current browser tab and your microphone. Native meeting
					apps and system audio are not available.
				</div>
			)}

			<button
				type="button"
				aria-label={isRecording ? "Stop recording" : "Start recording"}
				class={`record-btn ${isRecording ? "recording" : ""}`}
				onClick={onToggleRecording}
				disabled={!canRecord}
			>
				<span class="dot" />
			</button>

			<div class={`state-label ${state}`}>{stateLabels[state]}</div>
			{canRecord && (
				<div class="record-hint">
					{isRecording ? "Click again to stop" : "Click to start"}
				</div>
			)}
			{isStarting && waitingForMicrophone && (
				<output class="record-hint">
					Allow microphone access in the Diduny tab that opened, then come back
					here.
				</output>
			)}

			{error && <div class="error-msg">{error}</div>}
		</div>
	);
}
