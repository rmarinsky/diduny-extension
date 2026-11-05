export const en = {
	app: {
		title: "Diduny",
		unsupportedBrowser: "Diduny needs a supported browser",
		unsupportedBrowserIntro:
			"Use a current Chromium-based browser with the following capabilities:",
		checkingSession: "Checking your session…",
		workspace: "Workspace",
		nav: {
			aboutDelivery: "About delivery",
			dictation: "Dictation",
			library: "Library",
			settings: "Settings",
			signOut: "Sign out",
		},
	},
	capability: {
		audioWorklet: {
			label: "AudioWorklet",
			reason: "it keeps microphone capture responsive while dictating.",
		},
		opfsSyncAccess: {
			label: "OPFS synchronous access",
			reason:
				"it keeps in-progress audio recoverable after an interrupted tab.",
		},
		displayCaptureAudio: {
			label: "Display-capture audio",
			reason: "it is required for meeting recording.",
		},
		onDeviceSpeechRecognition: {
			label: "On-device speech recognition",
			reason: "it enables the local trial path without sending audio away.",
		},
	},
	auth: {
		description:
			"Sign in here once to make this browser available to the extension.",
		email: "Email",
		oneTimeCode: "One-time code",
		sendCode: "Send one-time code",
		signIn: "Sign in",
		useAnotherEmail: "Use another email",
		sendingCode: "Sending a one-time code…",
		checkInbox: "Check your inbox for the six-digit code.",
		signingIn: "Signing in…",
		couldNotSendCode: "Could not send the code.",
		couldNotVerifyCode: "Could not verify the code.",
		signedOut: "Signed out.",
		invalidEmail: "Enter a valid email address, like name@example.com.",
		invalidCode: "Enter the six-digit code from the email, like 123456.",
		incorrectCode:
			"That code is incorrect or has expired. Check the latest email, or choose “Use another email” to get a new code.",
		signOutConfirm: {
			title: "Sign out of Diduny?",
			body: "You'll need a new one-time code to sign in again.",
			confirm: "Sign out",
			cancel: "Stay signed in",
		},
	},
	theme: {
		toggleToDark: "Switch to dark theme",
		toggleToLight: "Switch to light theme",
	},
	about: {
		back: "Back to dictation",
	},
	onboarding: {
		intro: "Before you sign in, here's how Diduny works.",
		continueToSignIn: "Continue to sign in",
		step: "Step {current} of {total}",
		next: "Next",
		back: "Back",
		saved: "Saved.",
		choices: {
			cleanup: "Enable filler-word cleanup",
			announce: "Announce final live transcript",
		},
		microphone: {
			title: "Use your microphone",
			body: "Diduny needs microphone access before it can transcribe your words.",
			allowAlways:
				"When the browser asks, choose “Allow while visiting the site”. “Allow this time” ends when you close this tab, and you'll be asked again next time.",
			optional:
				"This is optional now - the browser will also ask when you start your first dictation.",
			allow: "Allow microphone",
			granted: "Microphone access is ready.",
			denied:
				"Microphone access is blocked. Allow it in your browser settings, then try again.",
			unsupported: "This browser cannot request microphone access.",
		},
		delivery: {
			title: "Where your words end up",
			body: "Diduny listens while you speak and writes what it hears into a text box on this page. When you stop, the text is there, ready to edit. Press Copy, then paste it wherever you were going - your email, your editor, a chat window. A web page can't type into other applications, so Diduny won't put text into the window you had open before. That's a limit of the browser, not a feature we skipped. What you get instead is a page you can dictate into all day: keep talking, keep appending, edit as you go, and copy when you're ready.",
			extension:
				"With the Diduny browser extension, your words go straight into the text field you are typing in on other pages - no copying, no switching tabs. Sign in here once so the extension can use this browser.",
			clipboardNote:
				"Diduny never writes to your clipboard on its own. Nothing is copied unless you press Copy, so whatever you copied five minutes ago is still there.",
		},
		provider: {
			title: "Which engine transcribes your voice",
			cloud:
				"Cloud transcription is more accurate and handles accents and background noise better. Your audio is sent to a transcription service to be processed. You'll need an account with it; signing in takes a minute and uses an emailed code, no password.",
			noSubstitution:
				"Diduny won't quietly swap engines. If cloud transcription is unavailable, it says so instead of using another engine - you always know what produced your text.",
		},
		retention: {
			neverChoice: "Never save recordings",
			neverNote:
				"With retention set to never, Diduny saves no recording and no transcript - nothing is written to your library at all. While you're actually speaking, audio is buffered in a temporary file so a crashed tab doesn't lose what you said. That file is deleted as soon as the recording finishes.",
		},
	},
	status: {
		ready: "Ready to dictate.",
		signIn: "Sign in to dictate.",
		serviceUnavailable: "Could not reach the Diduny service.",
		cancelled: "Dictation cancelled.",
		transcribing: "Transcribing…",
		noSpeech: "No speech detected. Nothing was sent.",
		realtimeFallback:
			"Realtime is unavailable. Transcribing the completed recording…",
		noText: "The transcription returned no text.",
		dictationAdded: "Dictation added to this document.",
		translationAdded: "Translation added to this document.",
		librarySaveFailed:
			"Dictation added. The local library could not save a copy.",
		dictationFailed: "Dictation failed.",
		browserCannotRecord: "This browser cannot record audio.",
		anotherTab: "Recording is active in another tab.",
		microphoneFallback:
			"Saved microphone is unavailable. Recording with {device}.",
		listening: "Listening…",
		couldNotStartMicrophone: "Could not start the microphone.",
		microphoneBlocked:
			"Microphone access is blocked. Open this site’s settings in your browser, allow Microphone, then try again.",
		microphoneNotFound:
			"No microphone was found. Connect a microphone, then try again.",
		microphoneBusy:
			"The microphone is in use by another app or could not be opened. Close the other app, then try again.",
		transcriptionTimedOut:
			"Transcription took too long and was stopped. Your document is unchanged; dictate again to retry.",
		transcriptionCancelled:
			"Transcription cancelled. Your document is unchanged.",
		copied: "Copied to clipboard.",
		documentCleared: "Document cleared.",
		clipboardDenied: "The browser did not allow clipboard access.",
		pasteBeforeTranslate: "Paste text before translating it.",
		translatingPasted: "Translating pasted text…",
		translationNoText:
			"The translation returned no text. Check the language pair and try again.",
		pastedTranslated: "Pasted text translated.",
		couldNotTranslate:
			"Could not translate the pasted text. Check the Diduny service and try again.",
	},
	dictation: {
		languages: "Spoken languages",
		languagesHint: "Nothing ticked: Diduny detects the language itself.",
		languagesInTranslation:
			"Translation dictation listens for {source}, the language you translate from.",
		translationMode: "Translation dictation",
		translationLanguages: "Translation dictation languages",
		document: "Dictation document",
		documentPlaceholder:
			"Your dictation appears here. You can edit it while you work.",
		start: "Start dictation",
		stop: "Stop dictation",
		hold: "Hold to record",
		cancel: "Cancel",
		copy: "Copy",
		clear: "Clear",
		microphoneLevel: "Microphone level",
		meterSending: "Sending",
		meterIdle: "Idle",
		meterElapsed: "{seconds}s",
		shortcut: "Shortcut: {shortcut}",
		shortcutOutsideFields: "Shortcut: {shortcut} outside text fields",
		pasteTitle: "Paste-in translation",
		pasteDescription:
			"Paste text into Diduny to translate it. Other applications are not read.",
		pasteLanguages: "Paste-in translation languages",
		textToTranslate: "Text to translate",
		translatePasted: "Translate pasted text",
		translationResult: "Translation result",
	},
	translation: {
		from: "From",
		to: "To",
		swap: "Swap languages",
	},
	liveTranscript: {
		title: "Live transcript",
		final: "Final",
		provisional: "Provisional",
	},
	floatingPanel: {
		open: "Float live panel",
		return: "Return live panel to page",
		unavailable:
			"Diduny could not open a floating panel. Keep the live panel in this page and try again.",
	},
	recovery: {
		untitledText: "Recovered audio from an interrupted recording.",
	},
	commandPalette: {
		title: "Command palette",
		close: "Close command palette",
		search: "Search recent transcripts",
		loading: "Loading recent transcripts…",
		empty: "No recent transcripts match your search.",
		results: "Recent transcripts",
	},
	microphone: {
		title: "Microphone",
		checking: "Checking microphone permission…",
		permissionRequired:
			"Microphone permission is required before devices can be named.",
		allow: "Allow microphone",
		blocked:
			"Microphone access is blocked. Open this site’s settings in your browser, allow Microphone, then return here and refresh.",
		unsupported: "This browser cannot enumerate microphone devices.",
		noneAvailable: "No microphone is available to this browser.",
		recordingMicrophone: "Recording microphone",
		browserDefault: "Browser default microphone",
		savedUnavailable:
			"Saved microphone is unavailable. The browser will use {device}.",
		refresh: "Refresh microphone devices",
		requesting: "Requesting microphone permission…",
		granted: "Microphone permission granted.",
		preferenceSaved: "Microphone preference saved.",
	},
	settings: {
		loading: "Loading settings…",
		title: "Settings",
		reset: "Reset settings",
		resetConfirm: {
			title: "Reset settings?",
			body: "Cleanup words, interface language, accessibility, microphone, keyboard shortcut, translation languages, spoken languages, and typing speed go back to their defaults. Retention and your library stay as they are.",
			confirm: "Reset settings",
			cancel: "Cancel",
		},
		resetDone: "Settings reset to defaults.",
		cleanupTitle: "Transcript cleanup",
		enableCleanup: "Enable filler-word cleanup",
		fillerWords: "Filler words to remove",
		fillerWordsHint:
			"Diduny deletes these from Library transcripts and copies, e.g. um, uh, like. Press Enter or a comma after each one; phrases such as “you know” work too.",
		fillerWordsPlaceholder: "Add a word, e.g. um",
		protectedLexicon: "Phrases to keep",
		protectedLexiconHint:
			"If a filler word is part of a phrase you need, add the phrase so it is never cut. E.g. with “like” removed, add “feel like” to keep “I feel like it”.",
		protectedLexiconPlaceholder: "Add a phrase, e.g. feel like",
		removeTerm: "Remove {term}",
		termLimit: "This list is full (100 entries).",
		saveCleanup: "Save cleanup",
		cleanupSaved:
			"Cleanup settings saved. New library views and copies use this text.",
		interfaceLanguage: "Interface language",
		saveInterfaceLanguage: "Save interface language",
		interfaceLanguageSaved: "Interface language saved.",
		accessibilityTitle: "Accessibility",
		announceLive: "Announce final live transcript",
		announceLiveDescription:
			"Live transcript is hidden from screen readers unless you enable this.",
		saveAccessibility: "Save accessibility settings",
		accessibilitySaved: "Accessibility setting saved.",
		shortcutTitle: "Keyboard shortcut",
		toggleDictation: "Toggle dictation",
		shortcutKey: "Key",
		shortcutHelp:
			"Turn on the modifier keys you want, then press a letter, digit, F1–F12, or Space in the Key field. You can also press the whole combination there. With Ctrl, Alt, or Meta it also works while you type in the document. Shortcuts the browser reserves, like Ctrl+R, are refused.",
		shortcutPreview: "Preview: {shortcut}",
		shortcutNeedsKey: "Press a key to finish the shortcut.",
		saveShortcut: "Save shortcut",
		invalidShortcut: "Choose a key for the shortcut.",
		commandPaletteShortcut:
			"{shortcut} opens the command palette and cannot be used.",
		reservedShortcut:
			"{shortcut} is reserved by this browser and cannot be used.",
		shortcutSaved: "Shortcut saved: {shortcut}.",
		translationLanguages: "Translation languages",
		translationSource: "Translation source language",
		translationTarget: "Translation target language",
		saveTranslation: "Save translation languages",
		translationSaved: "Translation languages saved.",
		sameTranslationLanguages:
			"Choose two different languages to translate between.",
		retentionTitle: "Retention",
		neverSaveDescription:
			"With retention set to never, Diduny saves no recording and no transcript - nothing is written to your library at all. While you're actually speaking, audio is buffered in a temporary file so a crashed tab doesn't lose what you said. That file is deleted as soon as the recording finishes.",
		dictationAndTranslation: "Dictation and translation",
		meetings: "Meetings",
		retentionSaved: "Retention policy saved.",
		statisticsTitle: "Dictation statistics",
		visibleWords:
			"{count, plural, one {# visible dictation word.} other {# visible dictation words.}}",
		dictated: "{duration} dictated.",
		timeSaved: "{duration} saved",
		slowerThanTyping: "{duration} slower than typing",
		typingSpeed: "Your typing speed, words per minute",
		typingSpeedHint:
			"Used to estimate the time dictation saves you. Most people type about {average} words per minute.",
		typingPrompt:
			"Measure your typing speed: type this sentence at your normal pace.",
		calibrationText: "Clear ideas deserve calm words and careful attention.",
		typingTestText: "Typing test",
		typingTestHint:
			"The timer starts with your first key and stops at your last.",
		saveMeasuredSpeed: "Save measured speed",
		typingNeedsWords: "Type the sentence before saving your measured speed.",
		typingMismatch: "Type the sentence exactly as shown to measure your speed.",
		typingTooFast:
			"That is faster than {max} words per minute. Type the sentence instead of pasting it.",
		typingMeasuredSaved: "Measured {speed} words per minute and saved it.",
		saveTypingSpeed: "Save typing speed",
		typingSpeedSaved: "Typing speed saved.",
		invalidTypingSpeed:
			"Enter a typing speed between 1 and {max} words per minute.",
		storageTitle: "Storage on this device",
		usesDisk: "Diduny uses {size} on disk.",
		downloadExport: "Download library export",
		saveFailed:
			"Could not save this setting. Check the local Diduny service and try again.",
		retention: {
			never: "Never save",
			days7: "7 days",
			days30: "30 days",
			days90: "90 days",
			year1: "1 year",
			forever: "Keep forever",
		},
	},
	library: {
		title: "Library",
		description: "Searches run on your local library server.",
		search: "Search library",
		recordingType: "Recording type",
		status: "Status",
		allTypes: "All types",
		allStatuses: "All statuses",
		searchButton: "Search",
		loading: "Loading library…",
		loadingRecording: "Loading recording…",
		empty: "No recordings match your search.",
		listLabel: "Library recordings",
		loadMore: "Load more",
		back: "Back to library",
		untitled: "Untitled recording",
		recovered: "Recovered recording",
		playback: "Recording playback",
		transcript: "Transcript",
		copyTranscript: "Copy transcript",
		transcriptCopied: "Transcript copied.",
		history: "Transcript history",
		currentVersion: "Current version",
		previousVersion: "Previous version",
		details: "Details",
		recordingTitle: "Title",
		descriptionLabel: "Description",
		saveDetails: "Save details",
		detailsSaved: "Details saved.",
		deleteLabel: "Delete recording",
		deleteWarning: "This permanently removes the recording and its audio file.",
		deletePermanently: "Delete permanently",
		cancelDelete: "Cancel delete",
		delete: "Delete recording",
		requestFailed: "The library request failed.",
		statusLabel: {
			failed: "Failed",
			partiallyRecovered: "Recovered",
			processing: "Processing",
			transcribed: "Transcribed",
			translated: "Translated",
			unprocessed: "Unprocessed",
		},
		typeLabel: {
			voice: "Dictation",
			meeting: "Meeting",
			meetingTranslation: "Meeting translation",
			translation: "Translation",
			fileTranscription: "File transcription",
		},
	},
	errors: {
		quotaExceeded:
			"You are out of hours ({used} of {limit} used). Add hours or wait for your plan to renew, then try again.",
		localProcessUnavailable:
			"The local Diduny process is not reachable. Start or restart it, then try again.",
		proxyUnavailable:
			"The transcription proxy is not reachable. Check its connection or restart it, then try again.",
		authenticationFailed:
			"Your Diduny sign-in has expired. Sign in again, then retry.",
		realtimeUnavailable:
			"Realtime transcription stopped after reconnecting. Check the local Diduny service and try again.",
		remoteAcquisitionUnavailableOnWeb:
			"YouTube URLs cannot be acquired in Diduny for the web. Download the file yourself and add it when file batches are available.",
		requestRejected:
			"The Diduny service rejected this request. Try again; if it continues, restart the local Diduny service.",
	},
	fallback: {
		englishOnly: "English fallback",
	},
	statistics: {
		recordings: "{count, plural, one {# recording} other {# recordings}}",
	},
} as const;
