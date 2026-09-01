import { expect, test } from "bun:test";
import {
	AUDIO_FORMAT,
	DEFAULT_SETTINGS,
	FINALIZE_PROFILES,
	REALTIME,
	VAD,
	cleanDictationText,
	copyRecordingText,
	createDiduny,
	createFakePlatform,
	displayRecordingText,
	resolveTranscriptHistory,
	timeSavedSeconds,
	updateSettings,
} from "../src/core";

test("keeps the canonical audio, VAD, and realtime constants in the core", () => {
	expect(AUDIO_FORMAT).toEqual({
		captureBufferFrames: 4096,
		channels: 1,
		hardwareInitTimeoutMs: 5000,
		sampleRate: 16000,
		wireFormat: "s16le",
	});
	expect(VAD).toEqual({
		frameSamples: 320,
		minimumPeak: 0.015,
		minimumRms: 0.0015,
		minimumVoicedDurationMs: 180,
		skipAboveBytes: 25 * 1024 * 1024,
	});
	expect(REALTIME.readyWatchdogMs).toBe(10_000);
	expect(FINALIZE_PROFILES.dictationFast.timeoutMs).toBe(1200);
	expect(FINALIZE_PROFILES.safe.timeoutMs).toBe(5000);
});

test("renders and copies recordings according to their type", () => {
	const meeting = {
		id: "meeting-1",
		createdAt: 0,
		status: "transcribed",
		text: "Plain fallback",
		type: "meeting",
		segments: [
			{ endMs: 2100, speaker: "1", startMs: 1000, text: "Hello" },
			{ endMs: 3200, speaker: "2", startMs: 2200, text: "World" },
		],
	};
	const dictation = { ...meeting, type: "voice" };

	expect(displayRecordingText(meeting)).toBe(
		"[00:01] Speaker 1: Hello\n[00:02] Speaker 2: World",
	);
	expect(copyRecordingText(meeting)).toBe(displayRecordingText(meeting));
	expect(displayRecordingText(dictation)).toBe("Plain fallback");
	expect(copyRecordingText(dictation)).toBe("Plain fallback");
});

test("resolves legacy history and keeps UI locale independent of speech settings", () => {
	const legacyRecording = {
		id: "legacy-1",
		createdAt: 0,
		provider: "local whisper",
		status: "transcribed",
		text: "Existing text",
		type: "voice",
	};

	expect(resolveTranscriptHistory(legacyRecording)).toMatchObject([
		{ kind: "local", text: "Existing text" },
	]);

	const ukrainianUi = updateSettings(DEFAULT_SETTINGS, { uiLocale: "uk" });
	expect(ukrainianUi.speechLanguageHints).toEqual(
		DEFAULT_SETTINGS.speechLanguageHints,
	);
});

test("cleans dictation without changing protected terms and calculates measured time saved", () => {
	const recording = {
		id: "dictation-1",
		createdAt: 0,
		status: "transcribed",
		text: "Um, Diduny, uh writes notes.",
		type: "voice",
	};
	const cleanup = {
		enabled: true,
		fillerWords: ["um", "uh", "diduny"],
		protectedLexicon: ["Diduny"],
	};

	expect(cleanDictationText(recording.text, cleanup)).toBe(
		"Diduny, writes notes.",
	);
	expect(displayRecordingText(recording, cleanup)).toBe(
		"Diduny, writes notes.",
	);
	expect(copyRecordingText(recording, cleanup)).toBe("Diduny, writes notes.");
	expect(
		cleanDictationText(recording.text, { ...cleanup, enabled: false }),
	).toBe(recording.text);
	expect(timeSavedSeconds("one two three four", 2, 60)).toBe(2);
	expect(timeSavedSeconds("one two", 1, null)).toBeNull();
});

test("constructs the core from a complete platform fake without browser or network access", () => {
	const platform = createFakePlatform();
	const diduny = createDiduny(platform);

	expect(diduny.state).toBe("idle");
	expect(Object.keys(platform).sort()).toEqual([
		"audio",
		"clipboard",
		"clock",
		"devices",
		"hotkeys",
		"http",
		"inference",
		"keyEvents",
		"library",
		"logger",
		"permissions",
		"power",
		"remoteMedia",
		"secrets",
		"settings",
		"systemAudio",
		"updater",
	]);
	expect(platform.http.requests).toEqual([]);
	expect(platform.hotkeys.isAvailable).toBeFalse();
	expect(platform.keyEvents.isAvailable).toBeFalse();
	expect(platform.secrets.isAvailable).toBeFalse();
	expect(platform.remoteMedia.canAcquire).toBeFalse();
	expect(platform.clipboard.canPaste).toBeFalse();
});
