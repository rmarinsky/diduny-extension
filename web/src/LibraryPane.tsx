import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { ProcessingStatus, RecordingType } from "../../src/core/models";
import type { LibraryDetail, LibraryPage } from "../../src/core/ports";
import {
	type LibraryListInput,
	deleteLibraryRecording,
	getLibraryRecording,
	listLibraryRecordings,
	updateLibraryRecording,
} from "./library";

const pageSize = 50;

const statuses: ReadonlyArray<{ label: string; value: ProcessingStatus }> = [
	{ label: "Failed", value: "failed" },
	{ label: "Recovered", value: "partiallyRecovered" },
	{ label: "Processing", value: "processing" },
	{ label: "Transcribed", value: "transcribed" },
	{ label: "Translated", value: "translated" },
	{ label: "Unprocessed", value: "unprocessed" },
];

const types: ReadonlyArray<{ label: string; value: RecordingType }> = [
	{ label: "Dictation", value: "voice" },
	{ label: "Meeting", value: "meeting" },
	{ label: "Meeting translation", value: "meetingTranslation" },
	{ label: "Translation", value: "translation" },
	{ label: "File transcription", value: "fileTranscription" },
];

function duration(seconds: number) {
	const total = Math.max(0, Math.round(seconds));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function dateTime(value: number) {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(value);
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "The library request failed.";
}

function RecordingDetail({
	onBack,
	onDeleted,
	onUpdated,
	recording,
}: {
	onBack(): void;
	onDeleted(): void;
	onUpdated(recording: LibraryDetail): void;
	recording: LibraryDetail;
}) {
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [description, setDescription] = useState(recording.description ?? "");
	const [isDeleting, setIsDeleting] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [message, setMessage] = useState("");
	const [title, setTitle] = useState(recording.title ?? "");

	async function copyTranscript() {
		try {
			await navigator.clipboard.writeText(recording.displayText);
			setMessage("Transcript copied.");
		} catch {
			setMessage("The browser did not allow clipboard access.");
		}
	}

	async function saveDetails(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setIsSaving(true);
		setMessage("");
		try {
			const updated = await updateLibraryRecording(recording.id, {
				description: description.trim() || null,
				title: title.trim() || null,
			});
			onUpdated(updated);
			setMessage("Details saved.");
		} catch (error) {
			setMessage(errorMessage(error));
		} finally {
			setIsSaving(false);
		}
	}

	async function deleteRecording() {
		setIsDeleting(true);
		setMessage("");
		try {
			await deleteLibraryRecording(recording.id);
			onDeleted();
		} catch (error) {
			setIsDeleting(false);
			setMessage(errorMessage(error));
		}
	}

	return (
		<section aria-labelledby="recording-title" className="recording-detail">
			<button onClick={onBack} type="button">
				Back to library
			</button>
			<header>
				<div>
					<h2 id="recording-title">
						{recording.title?.trim() || "Untitled recording"}
					</h2>
					<p>
						{dateTime(recording.createdAt)} ·{" "}
						{duration(recording.durationSeconds)}
					</p>
				</div>
				{recording.status === "partiallyRecovered" ? (
					<p className="recovered">Recovered recording</p>
				) : null}
			</header>
			<audio
				aria-label="Recording playback"
				controls
				preload="metadata"
				src={`/bff/library/${recording.id}/media`}
			>
				<track
					default
					kind="captions"
					label="Transcript"
					src={`/bff/library/${recording.id}/captions.vtt`}
					srcLang="und"
				/>
			</audio>
			<div className="controls">
				<button onClick={() => void copyTranscript()} type="button">
					Copy transcript
				</button>
			</div>
			<pre aria-label="Transcript" className="transcript">
				{recording.displayText}
			</pre>
			<section aria-labelledby="history-title">
				<h3 id="history-title">Transcript history</h3>
				<ol className="history">
					{recording.history.map((version, index) => (
						<li key={version.id}>
							<strong>
								{index === 0 ? "Current version" : "Previous version"}
							</strong>
							<span>
								{version.provider} · {dateTime(version.createdAt)}
							</span>
							<pre>{version.text}</pre>
						</li>
					))}
				</ol>
			</section>
			<form className="metadata-form" onSubmit={saveDetails}>
				<h3>Details</h3>
				<label htmlFor="recording-title-input">
					Title
					<input
						id="recording-title-input"
						onChange={(event) => setTitle(event.target.value)}
						value={title}
					/>
				</label>
				<label htmlFor="recording-description-input">
					Description
					<textarea
						id="recording-description-input"
						onChange={(event) => setDescription(event.target.value)}
						value={description}
					/>
				</label>
				<button disabled={isSaving} type="submit">
					Save details
				</button>
			</form>
			<section aria-label="Delete recording" className="delete-recording">
				{confirmingDelete ? (
					<>
						<p>This permanently removes the recording and its audio file.</p>
						<button
							disabled={isDeleting}
							onClick={() => void deleteRecording()}
							type="button"
						>
							Delete permanently
						</button>
						<button
							disabled={isDeleting}
							onClick={() => setConfirmingDelete(false)}
							type="button"
						>
							Cancel delete
						</button>
					</>
				) : (
					<button onClick={() => setConfirmingDelete(true)} type="button">
						Delete recording
					</button>
				)}
			</section>
			<p aria-live="polite" className="status">
				{message}
			</p>
		</section>
	);
}

export function LibraryPane({
	onLibraryChanged,
	revision,
}: {
	onLibraryChanged(): void;
	revision: number;
}) {
	const [detail, setDetail] = useState<LibraryDetail | null>(null);
	const [error, setError] = useState("");
	const [isLoading, setIsLoading] = useState(true);
	const [page, setPage] = useState<LibraryPage>({ items: [] });
	const [query, setQuery] = useState<LibraryListInput>({});
	const [search, setSearch] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [status, setStatus] = useState("");
	const [type, setType] = useState("");

	const loadList = useCallback(
		async (offset = 0, append = false) => {
			setError("");
			setIsLoading(true);
			try {
				const next = await listLibraryRecordings({
					...query,
					limit: pageSize,
					offset,
				});
				setPage((current) =>
					append ? { ...next, items: [...current.items, ...next.items] } : next,
				);
			} catch (reason) {
				setError(errorMessage(reason));
			} finally {
				setIsLoading(false);
			}
		},
		[query],
	);

	useEffect(() => {
		void revision;
		void loadList();
	}, [loadList, revision]);

	useEffect(() => {
		void revision;
		if (!selectedId) {
			setDetail(null);
			return;
		}
		let active = true;
		setError("");
		void getLibraryRecording(selectedId)
			.then((recording) => {
				if (active) setDetail(recording);
			})
			.catch((reason) => {
				if (active) setError(errorMessage(reason));
			});
		return () => {
			active = false;
		};
	}, [revision, selectedId]);

	function applyFilters(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setQuery({
			...(search.trim() ? { search: search.trim() } : {}),
			...(status ? { status: [status as ProcessingStatus] } : {}),
			...(type ? { type: [type as RecordingType] } : {}),
		});
	}

	function returnToList() {
		setError("");
		setSelectedId(null);
		void loadList();
	}

	if (selectedId) {
		if (error) {
			return (
				<section className="recording-detail">
					<button onClick={returnToList} type="button">
						Back to library
					</button>
					<p role="alert">{error}</p>
				</section>
			);
		}
		if (!detail || detail.id !== selectedId)
			return <p aria-live="polite">Loading recording…</p>;
		return (
			<RecordingDetail
				onBack={returnToList}
				onDeleted={() => {
					onLibraryChanged();
					returnToList();
				}}
				onUpdated={(recording) => {
					setDetail(recording);
					onLibraryChanged();
				}}
				recording={detail}
			/>
		);
	}

	return (
		<section aria-labelledby="library-title" className="library">
			<header>
				<h2 id="library-title">Library</h2>
				<p>Searches run on your local library server.</p>
			</header>
			<form className="library-filters" onSubmit={applyFilters}>
				<label htmlFor="library-search">
					Search library
					<input
						id="library-search"
						onChange={(event) => setSearch(event.target.value)}
						value={search}
					/>
				</label>
				<label htmlFor="library-type">
					Recording type
					<select
						id="library-type"
						onChange={(event) => setType(event.target.value)}
						value={type}
					>
						<option value="">All types</option>
						{types.map((item) => (
							<option key={item.value} value={item.value}>
								{item.label}
							</option>
						))}
					</select>
				</label>
				<label htmlFor="library-status">
					Status
					<select
						id="library-status"
						onChange={(event) => setStatus(event.target.value)}
						value={status}
					>
						<option value="">All statuses</option>
						{statuses.map((item) => (
							<option key={item.value} value={item.value}>
								{item.label}
							</option>
						))}
					</select>
				</label>
				<button type="submit">Search</button>
			</form>
			{error ? <p role="alert">{error}</p> : null}
			{isLoading ? <p aria-live="polite">Loading library…</p> : null}
			{!isLoading && !error && page.items.length === 0 ? (
				<p>No recordings match your search.</p>
			) : null}
			<ul aria-label="Library recordings" className="recording-list">
				{page.items.map((recording) => (
					<li key={recording.id}>
						<button onClick={() => setSelectedId(recording.id)} type="button">
							<span>{recording.displayTitle}</span>
							<small>
								{duration(recording.durationSeconds)} · {recording.type} ·{" "}
								{recording.status}
							</small>
						</button>
					</li>
				))}
			</ul>
			{page.nextOffset !== undefined ? (
				<button
					disabled={isLoading}
					onClick={() => void loadList(page.nextOffset, true)}
					type="button"
				>
					Load more
				</button>
			) : null}
		</section>
	);
}
