import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppBar } from "./ThemeToggle";
import { userErrorMessage } from "./errors";
import {
	type OnboardingChoices,
	type PendingChoices,
	choicesWithPending,
	defaultOnboardingChoices,
} from "./onboarding-choices";
import {
	getWorkspaceSettings,
	updateRetentionPolicy,
	updateWorkspaceSettings,
} from "./settings";

type MicrophoneState = "denied" | "granted" | "idle" | "unsupported";
type Step = "delivery" | "engine";

export const onboardingCompletedStorageKey = "diduny.onboarding.completed";

function DeliveryExplanation() {
	const { t } = useTranslation();
	return (
		<>
			<p>{t("onboarding.delivery.body")}</p>
			<p>{t("onboarding.delivery.extension")}</p>
			<p>{t("onboarding.delivery.clipboardNote")}</p>
		</>
	);
}

/**
 * Two pages: where the words end up, then the engine plus the settings checkboxes.
 * Controlled: the parent decides whether a change is held for sign-in or saved at once.
 */
function DeliveryFlow({
	afterChoices,
	choices,
	disabled = false,
	finishLabel,
	focusOnMount = false,
	onChoiceChange,
	onFinish,
	status,
}: {
	afterChoices?: ReactNode;
	choices: OnboardingChoices;
	disabled?: boolean;
	finishLabel: string;
	focusOnMount?: boolean;
	onChoiceChange(changes: Partial<OnboardingChoices>): void;
	onFinish(): void;
	status?: string;
}) {
	const { t } = useTranslation();
	const [step, setStep] = useState<Step>("delivery");
	const title = useRef<HTMLHeadingElement>(null);
	const firstRender = useRef(true);

	// Move focus to the heading of each new page; on first render only when asked to.
	// biome-ignore lint/correctness/useExhaustiveDependencies: step is the trigger
	useEffect(() => {
		if (!firstRender.current || focusOnMount) title.current?.focus();
		firstRender.current = false;
	}, [step, focusOnMount]);

	return (
		<section aria-labelledby="delivery-flow-title" className="card flow">
			<p className="note">
				{t("onboarding.step", {
					current: step === "delivery" ? 1 : 2,
					total: 2,
				})}
			</p>
			{step === "delivery" ? (
				<>
					<h2 id="delivery-flow-title" ref={title} tabIndex={-1}>
						{t("onboarding.delivery.title")}
					</h2>
					<DeliveryExplanation />
					<div className="card-actions">
						<button
							className="primary"
							onClick={() => setStep("engine")}
							type="button"
						>
							{t("onboarding.next")}
						</button>
					</div>
				</>
			) : (
				<>
					<h2 id="delivery-flow-title" ref={title} tabIndex={-1}>
						{t("onboarding.provider.title")}
					</h2>
					<p>{t("onboarding.provider.cloud")}</p>
					<p>{t("onboarding.provider.noSubstitution")}</p>
					<label className="checkbox" htmlFor="onboarding-never-save">
						<input
							checked={choices.neverSaveRecordings}
							disabled={disabled}
							id="onboarding-never-save"
							onChange={(event) =>
								onChoiceChange({ neverSaveRecordings: event.target.checked })
							}
							type="checkbox"
						/>
						{t("onboarding.retention.neverChoice")}
					</label>
					{choices.neverSaveRecordings ? (
						<p className="note">{t("onboarding.retention.neverNote")}</p>
					) : null}
					<label className="checkbox" htmlFor="onboarding-cleanup">
						<input
							checked={choices.textCleanupEnabled}
							disabled={disabled}
							id="onboarding-cleanup"
							onChange={(event) =>
								onChoiceChange({ textCleanupEnabled: event.target.checked })
							}
							type="checkbox"
						/>
						{t("onboarding.choices.cleanup")}
					</label>
					<label className="checkbox" htmlFor="onboarding-announce">
						<input
							checked={choices.announceLiveTranscript}
							disabled={disabled}
							id="onboarding-announce"
							onChange={(event) =>
								onChoiceChange({ announceLiveTranscript: event.target.checked })
							}
							type="checkbox"
						/>
						{t("onboarding.choices.announce")}
					</label>
					{afterChoices}
					<p aria-live="polite" className="status">
						{status ?? ""}
					</p>
					<div className="card-actions">
						<button
							className="secondary"
							onClick={() => setStep("delivery")}
							type="button"
						>
							{t("onboarding.back")}
						</button>
						<button className="primary" onClick={onFinish} type="button">
							{finishLabel}
						</button>
					</div>
				</>
			)}
		</section>
	);
}

/**
 * First-visit page: explains delivery and the engine, then hands off to email sign-in.
 * Reopened from the sign-in screen, it shows the choices made last time.
 */
export function StartPage({
	initialChoices,
	onContinue,
}: {
	initialChoices: PendingChoices;
	onContinue(choices: PendingChoices): void;
}) {
	const { t } = useTranslation();
	const [microphone, setMicrophone] = useState<MicrophoneState>("idle");
	const [pending, setPending] = useState(initialChoices);

	// Show an earlier grant (or block) instead of offering the button again.
	useEffect(() => {
		let cancelled = false;
		navigator.permissions
			?.query({ name: "microphone" as PermissionName })
			.then((permission) => {
				if (cancelled || permission.state === "prompt") return;
				setMicrophone(permission.state);
			})
			.catch(() => {
				// A browser that can't report the permission keeps the button available.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function requestMicrophone() {
		if (!navigator.mediaDevices?.getUserMedia) {
			setMicrophone("unsupported");
			return;
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			for (const track of stream.getTracks()) track.stop();
			setMicrophone("granted");
		} catch {
			setMicrophone("denied");
		}
	}

	return (
		<main className="shell start">
			<AppBar />
			<p className="lead">{t("onboarding.intro")}</p>
			<DeliveryFlow
				afterChoices={
					<div className="microphone-choice">
						<h3>{t("onboarding.microphone.title")}</h3>
						<p>{t("onboarding.microphone.body")}</p>
						<p>{t("onboarding.microphone.allowAlways")}</p>
						<p className="note">{t("onboarding.microphone.optional")}</p>
						<div className="card-actions">
							<button
								className="secondary"
								disabled={microphone === "granted"}
								onClick={() => void requestMicrophone()}
								type="button"
							>
								{t("onboarding.microphone.allow")}
							</button>
							<p aria-live="polite" className="status">
								{microphone === "granted"
									? t("onboarding.microphone.granted")
									: microphone === "denied"
										? t("onboarding.microphone.denied")
										: microphone === "unsupported"
											? t("onboarding.microphone.unsupported")
											: ""}
							</p>
						</div>
					</div>
				}
				choices={choicesWithPending(pending)}
				finishLabel={t("onboarding.continueToSignIn")}
				onChoiceChange={(changes) =>
					setPending((current) => ({ ...current, ...changes }))
				}
				onFinish={() => onContinue(pending)}
			/>
		</main>
	);
}

/**
 * Signed-in "About delivery": the same two pages, but the checkboxes show the
 * account's current settings and save the moment they change.
 */
export function AboutDelivery({
	onBack,
	onSettingsChanged,
}: {
	onBack(): void;
	onSettingsChanged(): void;
}) {
	const { t } = useTranslation();
	const [choices, setChoices] = useState<OnboardingChoices | null>(null);
	const [status, setStatus] = useState("");

	useEffect(() => {
		let cancelled = false;
		getWorkspaceSettings()
			.then((snapshot) => {
				if (cancelled) return;
				setChoices({
					announceLiveTranscript: snapshot.settings.announceLiveTranscript,
					neverSaveRecordings: snapshot.retention.dictation === "never",
					textCleanupEnabled: snapshot.settings.textCleanupEnabled,
				});
			})
			.catch((error) => {
				if (!cancelled) setStatus(userErrorMessage(error, t));
			});
		return () => {
			cancelled = true;
		};
	}, [t]);

	async function change(changes: Partial<OnboardingChoices>) {
		if (!choices) return;
		const previous = choices;
		setChoices({ ...choices, ...changes });
		setStatus("");
		try {
			if (changes.neverSaveRecordings !== undefined)
				await updateRetentionPolicy(
					"dictation",
					changes.neverSaveRecordings ? "never" : "forever",
				);
			const { announceLiveTranscript, textCleanupEnabled } = changes;
			if (
				announceLiveTranscript !== undefined ||
				textCleanupEnabled !== undefined
			)
				await updateWorkspaceSettings({
					...(announceLiveTranscript !== undefined && {
						announceLiveTranscript,
					}),
					...(textCleanupEnabled !== undefined && { textCleanupEnabled }),
				});
			setStatus(t("onboarding.saved"));
			onSettingsChanged();
		} catch (error) {
			setChoices(previous);
			setStatus(userErrorMessage(error, t));
		}
	}

	return (
		<DeliveryFlow
			choices={choices ?? defaultOnboardingChoices}
			disabled={choices === null}
			finishLabel={t("about.back")}
			focusOnMount
			onChoiceChange={(changes) => void change(changes)}
			onFinish={onBack}
			status={status}
		/>
	);
}
