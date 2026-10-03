import { useCallback, useEffect, useRef, useState } from "react";
import { onMessage } from "../../../lib/messaging/bridge";
import { appendTranscript } from "../../../web/src/dictation";

/**
 * The panel's Transcript, typed edits included, kept while the browser runs so
 * closing the side panel does not lose it. Logout removes it.
 */
const DRAFT_STORAGE_KEY = "didunyPanelTranscript";
const stripTags = (s: string) => s.replace(/<\/?(?:end|fin|eos)>/gi, "");

interface TranscriptDraft {
	micText: string;
	tabText: string;
}

export interface SourceState {
	/** Finished results plus the user's edits; streamed tokens never land here. */
	finalText: string;
	/** What the current recording has streamed so far, shown in the live box. */
	liveFinal: string;
	liveProvisional: string;
}

const EMPTY_SOURCE: SourceState = {
	finalText: "",
	liveFinal: "",
	liveProvisional: "",
};

const withoutLive = (prev: SourceState): SourceState => ({
	...prev,
	liveFinal: "",
	liveProvisional: "",
});

function draftText(value: unknown, key: keyof TranscriptDraft) {
	const text =
		value && typeof value === "object"
			? (value as Partial<TranscriptDraft>)[key]
			: undefined;
	return typeof text === "string" ? text : "";
}

export function useTranscript() {
	const [mic, setMic] = useState<SourceState>(EMPTY_SOURCE);
	const [tab, setTab] = useState<SourceState>(EMPTY_SOURCE);
	const [copied, setCopied] = useState(false);
	/** Counts finished results, so the views can scroll to the newest one. */
	const [resultCount, setResultCount] = useState(0);
	const draftLoaded = useRef(false);

	useEffect(() => {
		chrome.storage.session
			.get(DRAFT_STORAGE_KEY)
			.then((stored) => {
				const draft = stored[DRAFT_STORAGE_KEY];
				// A result that arrived while the draft loaded is kept after it.
				setMic((prev) => ({
					...prev,
					finalText: appendTranscript(
						draftText(draft, "micText"),
						prev.finalText,
					),
				}));
				setTab((prev) => ({
					...prev,
					finalText: appendTranscript(
						draftText(draft, "tabText"),
						prev.finalText,
					),
				}));
			})
			.catch(() => {})
			.finally(() => {
				draftLoaded.current = true;
			});
	}, []);

	useEffect(() => {
		if (!draftLoaded.current) return;
		const draft: TranscriptDraft = {
			micText: mic.finalText,
			tabText: tab.finalText,
		};
		const saved =
			draft.micText || draft.tabText
				? chrome.storage.session.set({ [DRAFT_STORAGE_KEY]: draft })
				: chrome.storage.session.remove(DRAFT_STORAGE_KEY);
		saved.catch(() => {});
	}, [mic.finalText, tab.finalText]);

	useEffect(() => {
		return onMessage((msg) => {
			if (
				msg.type === "recording-state-changed" &&
				(msg.state === "starting" ||
					msg.state === "idle" ||
					msg.state === "error")
			) {
				setMic(withoutLive);
				setTab(withoutLive);
			}

			if (msg.type === "realtime-tokens") {
				const setter = msg.source === "tab" ? setTab : setMic;
				let finalChunk = "";
				let provisional = "";
				for (const t of msg.tokens) {
					if (t.is_final) {
						finalChunk += stripTags(t.text);
					} else {
						provisional += stripTags(t.text);
					}
				}
				setter((prev) => ({
					...prev,
					liveFinal: prev.liveFinal + finalChunk,
					liveProvisional: provisional,
				}));
			}

			if (msg.type === "transcription-complete") {
				const setter = msg.source === "tab" ? setTab : setMic;
				// Only the post-processed result joins the transcript, below a --- line as in the web app.
				setter((prev) => ({
					finalText: appendTranscript(prev.finalText, stripTags(msg.text)),
					liveFinal: "",
					liveProvisional: "",
				}));
				setResultCount((count) => count + 1);
			}
		});
	}, []);

	const allText = [tab.finalText, mic.finalText].filter(Boolean).join("\n\n");

	const copyToClipboard = useCallback(async () => {
		if (!allText) return;
		await navigator.clipboard.writeText(allText);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [allText]);

	// Clears the transcript only; a recording in progress keeps its live text.
	const clear = useCallback(() => {
		setMic((prev) => ({ ...prev, finalText: "" }));
		setTab((prev) => ({ ...prev, finalText: "" }));
	}, []);

	// Typed edits become the text later dictation results append to.
	const editMic = useCallback((finalText: string) => {
		setMic((prev) => ({ ...prev, finalText }));
	}, []);

	/** Logout: nothing from this session stays in the panel or in storage. */
	const reset = useCallback(() => {
		setMic(EMPTY_SOURCE);
		setTab(EMPTY_SOURCE);
		chrome.storage.session.remove(DRAFT_STORAGE_KEY).catch(() => {});
	}, []);

	return {
		mic,
		tab,
		allText,
		copied,
		copyToClipboard,
		clear,
		editMic,
		reset,
		resultCount,
	};
}
