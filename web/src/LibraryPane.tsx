import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProcessingStatus, RecordingType } from "../../src/core/models";
import type { LibraryDetail, LibraryPage } from "../../src/core/ports";
import { userErrorMessage } from "./errors";
import {
	type LibraryListInput,
	deleteLibraryRecording,
	getLibraryRecording,
	listLibraryRecordings,
	updateLibraryRecording,
} from "./library";

const pageSize = 50;

const statuses: readonly ProcessingStatus[] = [
	"failed",
	"partiallyRecovered",
	"processing",
	"transcribed",
	"translated",
	"unprocessed",
];

const types: readonly RecordingType[] = [
	"voice",
	"meeting",
	"meetingTranslation",
	"translation",
	"fileTranscription",
];

function duration(seconds: number) {
	const total = Math.max(0, Math.round(seconds));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function dateTime(value: number, locale: string) {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(value);
}

function errorMessage(
	error: unknown,
	t: (key: string, options?: Record<string, unknown>) => string,
) {
	return userErrorMessage(error, t);
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
	const { i18n, t } = useTranslation();
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [description, setDescription] = useState(recording.description ?? "");
	const [isDeleting, setIsDeleting] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [message, setMessage] = useState("");
	const [title, setTitle] = useState(recording.title ?? "");

	async function copyTranscript() {
		try {
			await navigator.clipboard.writeText(recording.displayText);
			setMessage(t("library.transcriptCopied"));
		} catch {
			setMessage(t("status.clipboardDenied"));
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
			setMessage(t("library.detailsSaved"));
		} catch (error) {
			setMessage(errorMessage(error, t));
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
			setMessage(errorMessage(error, t));
		}
	}

	return (
		<section aria-labelledby="recording-title" className="recording-detail">
			<button onClick={onBack} type="button">
				{t("library.back")}
			</button>
			<header>
				<div>
					<h2 id="recording-title">
						{recording.title?.trim() || t("library.untitled")}
					</h2>
					<p>
						{dateTime(recording.createdAt, i18n.language)} ·{" "}
						{duration(recording.durationSeconds)}
					</p>
				</div>
				{recording.status === "partiallyRecovered" ? (
					<p className="recovered">{t("library.recovered")}</p>
				) : null}
			</header>
			<audio
				aria-label={t("library.playback")}
				controls
				preload="metadata"
				src={`/bff/library/${recording.id}/media`}
			>
				<track
					default
					kind="captions"
					label={t("library.transcript")}
					src={`/bff/library/${recording.id}/captions.vtt`}
					srcLang="und"
				/>
			</audio>
			<div className="controls">
				<button onClick={() => void copyTranscript()} type="button">
					{t("library.copyTranscript")}
				</button>
			</div>
			<pre aria-label={t("library.transcript")} className="transcript">
				{recording.displayText}
			</pre>
			<section aria-labelledby="history-title">
				<h3 id="history-title">{t("library.history")}</h3>
				<ol className="history">
					{recording.history.map((version, index) => (
						<li key={version.id}>
							<strong>
								{index === 0
									? t("library.currentVersion")
									: t("library.previousVersion")}
							</strong>
							<span>
								{version.provider} ·{" "}
								{dateTime(version.createdAt, i18n.language)}
							</span>
							<pre>{version.text}</pre>
						</li>
					))}
				</ol>
			</section>
			<form className="metadata-form" onSubmit={saveDetails}>
				<h3>{t("library.details")}</h3>
				<label htmlFor="recording-title-input">
					{t("library.recordingTitle")}
					<input
						id="recording-title-input"
						onChange={(event) => setTitle(event.target.value)}
						value={title}
					/>
				</label>
				<label htmlFor="recording-description-input">
					{t("library.descriptionLabel")}
					<textarea
						id="recording-description-input"
						onChange={(event) => setDescription(event.target.value)}
						value={description}
					/>
				</label>
				<button disabled={isSaving} type="submit">
					{t("library.saveDetails")}
				</button>
			</form>
			<section
				aria-label={t("library.deleteLabel")}
				className="delete-recording"
			>
				{confirmingDelete ? (
					<>
						<p>{t("library.deleteWarning")}</p>
						<button
							disabled={isDeleting}
							onClick={() => void deleteRecording()}
							type="button"
						>
							{t("library.deletePermanently")}
						</button>
						<button
							disabled={isDeleting}
							onClick={() => setConfirmingDelete(false)}
							type="button"
						>
							{t("library.cancelDelete")}
						</button>
					</>
				) : (
					<button onClick={() => setConfirmingDelete(true)} type="button">
						{t("library.delete")}
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
	const { t } = useTranslation();
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
				setError(errorMessage(reason, t));
			} finally {
				setIsLoading(false);
			}
		},
		[query, t],
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
				if (active) setError(errorMessage(reason, t));
			});
		return () => {
			active = false;
		};
	}, [revision, selectedId, t]);

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
						{t("library.back")}
					</button>
					<p role="alert">{error}</p>
				</section>
			);
		}
		if (!detail || detail.id !== selectedId)
			return <p aria-live="polite">{t("library.loadingRecording")}</p>;
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
				<h2 id="library-title">{t("library.title")}</h2>
				<p>{t("library.description")}</p>
			</header>
			<form className="library-filters" onSubmit={applyFilters}>
				<label htmlFor="library-search">
					{t("library.search")}
					<input
						id="library-search"
						onChange={(event) => setSearch(event.target.value)}
						value={search}
					/>
				</label>
				<label htmlFor="library-type">
					{t("library.recordingType")}
					<select
						id="library-type"
						onChange={(event) => setType(event.target.value)}
						value={type}
					>
						<option value="">{t("library.allTypes")}</option>
						{types.map((item) => (
							<option key={item} value={item}>
								{t(`library.typeLabel.${item}`)}
							</option>
						))}
					</select>
				</label>
				<label htmlFor="library-status">
					{t("library.status")}
					<select
						id="library-status"
						onChange={(event) => setStatus(event.target.value)}
						value={status}
					>
						<option value="">{t("library.allStatuses")}</option>
						{statuses.map((item) => (
							<option key={item} value={item}>
								{t(`library.statusLabel.${item}`)}
							</option>
						))}
					</select>
				</label>
				<button type="submit">{t("library.searchButton")}</button>
			</form>
			{error ? <p role="alert">{error}</p> : null}
			{isLoading ? <p aria-live="polite">{t("library.loading")}</p> : null}
			{!isLoading && !error && page.items.length === 0 ? (
				<p>{t("library.empty")}</p>
			) : null}
			<ul aria-label={t("library.listLabel")} className="recording-list">
				{page.items.map((recording) => (
					<li key={recording.id}>
						<button onClick={() => setSelectedId(recording.id)} type="button">
							<span>{recording.displayTitle}</span>
							<small>
								{duration(recording.durationSeconds)} ·{" "}
								{t(`library.typeLabel.${recording.type}`)} ·{" "}
								{t(`library.statusLabel.${recording.status}`)}
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
					{t("library.loadMore")}
				</button>
			) : null}
		</section>
	);
}
