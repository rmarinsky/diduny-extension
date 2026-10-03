import { ExtensionThemeToggle } from "../../lib/ExtensionThemeToggle";
import { AuthScreen } from "./components/AuthScreen";
import { MeetingTranscriptView } from "./components/MeetingTranscriptView";
import { RecordingControls } from "./components/RecordingControls";
import { TranscriptView } from "./components/TranscriptView";
import { useAuth } from "./hooks/useAuth";
import { useRecording } from "./hooks/useRecording";
import { type SourceState, useTranscript } from "./hooks/useTranscript";

export function App() {
	const auth = useAuth();
	const recording = useRecording();
	const transcript = useTranscript();

	if (auth.step !== "authenticated") {
		return (
			<>
				<div className="topbar">
					<ExtensionThemeToggle />
				</div>
				<AuthScreen
					loading={auth.loading}
					error={auth.error}
					onOpenSignIn={() => void auth.openBffSignIn()}
					onRefresh={() => void auth.refresh()}
				/>
			</>
		);
	}

	// The live box shows while audio streams and until the final result arrives, as in the web app.
	const showLive =
		recording.state === "recording" || recording.state === "processing";
	const liveText = (source: SourceState) =>
		showLive
			? { final: source.liveFinal, provisional: source.liveProvisional }
			: null;

	return (
		<>
			<div className="topbar">
				<ExtensionThemeToggle />
			</div>
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
				onLogout={() => {
					transcript.reset();
					void auth.logout();
				}}
				error={recording.error}
				waitingForMicrophone={recording.waitingForMicrophone}
			/>
			{recording.mode === "meeting" ? (
				<MeetingTranscriptView
					tabText={transcript.tab.finalText}
					micText={transcript.mic.finalText}
					live={liveText(transcript.tab)}
					copied={transcript.copied}
					resultCount={transcript.resultCount}
					onCopy={transcript.copyToClipboard}
					onClear={transcript.clear}
				/>
			) : (
				<TranscriptView
					finalText={transcript.mic.finalText}
					live={liveText(transcript.mic)}
					copied={transcript.copied}
					deliveryNotice={recording.deliveryNotice}
					resultCount={transcript.resultCount}
					onCopy={transcript.copyToClipboard}
					onClear={transcript.clear}
					onEdit={transcript.editMic}
				/>
			)}
		</>
	);
}
