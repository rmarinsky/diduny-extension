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
				loading={auth.loading}
				error={auth.error}
				onOpenSignIn={() => void auth.openBffSignIn()}
				onRefresh={() => void auth.refresh()}
			/>
		);
	}

	return (
		<>
			<RecordingControls
				state={recording.state}
				mode={recording.mode}
				language={recording.language}
				translationTargetLanguage={recording.translationTargetLanguage}
				diarization={recording.diarization}
				userEmail={auth.user?.email ?? ""}
				onToggleRecording={recording.toggleRecording}
				onModeChange={recording.setMode}
				onLanguageChange={recording.setLanguage}
				onTranslationTargetLanguageChange={
					recording.setTranslationTargetLanguage
				}
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
					deliveryNotice={recording.deliveryNotice}
					onCopy={transcript.copyToClipboard}
					onClear={transcript.clear}
				/>
			)}
		</>
	);
}
