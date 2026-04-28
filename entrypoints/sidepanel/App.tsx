import { AuthScreen } from "./components/AuthScreen";
import { MeetingTranscriptView } from "./components/MeetingTranscriptView";
import { RecordingControls } from "./components/RecordingControls";
import { TranscriptView } from "./components/TranscriptView";
import { useAuth } from "./hooks/useAuth";
import { useRecording } from "./hooks/useRecording";
import { useTranscript } from "./hooks/useTranscript";

export function App() {
	const auth = useAuth();
	const recording = useRecording();
	const transcript = useTranscript();

	if (auth.step !== "authenticated") {
		return (
			<AuthScreen
				step={auth.step}
				loading={auth.loading}
				error={auth.error}
				onSendOtp={auth.requestOtp}
				onVerifyOtp={auth.submitOtp}
			/>
		);
	}

	return (
		<>
			<RecordingControls
				state={recording.state}
				mode={recording.mode}
				language={recording.language}
				diarization={recording.diarization}
				userEmail={auth.user?.email ?? ""}
				onToggleRecording={recording.toggleRecording}
				onModeChange={recording.setMode}
				onLanguageChange={recording.setLanguage}
				onDiarizationChange={recording.setDiarization}
				onLogout={auth.logout}
				error={recording.error}
			/>
			{recording.mode === "meeting" ? (
				<MeetingTranscriptView
					tab={transcript.tab}
					mic={transcript.mic}
					copied={transcript.copied}
					onCopy={transcript.copyToClipboard}
					onClear={transcript.clear}
				/>
			) : (
				<TranscriptView
					finalText={transcript.mic.finalText}
					interimText={transcript.mic.interimText}
					copied={transcript.copied}
					onCopy={transcript.copyToClipboard}
					onClear={transcript.clear}
				/>
			)}
		</>
	);
}
