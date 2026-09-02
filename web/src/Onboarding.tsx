import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RetentionPolicy } from "../../src/core/ports";

type OnboardingStep = "delivery" | "microphone" | "provider";
type MicrophoneState = "denied" | "granted" | "idle" | "unsupported";

export const onboardingCompletedStorageKey = "diduny.onboarding.completed";
export const pendingRetentionStorageKey = "diduny.onboarding.retention";

export function Onboarding({
	asDialog = false,
	initialStep = "microphone",
	onClose,
	onComplete,
}: {
	asDialog?: boolean;
	initialStep?: OnboardingStep;
	onClose?(): void;
	onComplete(retention: RetentionPolicy): void;
}) {
	const { t } = useTranslation();
	const [microphone, setMicrophone] = useState<MicrophoneState>("idle");
	const [retention, setRetention] = useState<RetentionPolicy>("forever");
	const [step, setStep] = useState<OnboardingStep>(initialStep);
	const Container = asDialog ? "section" : "main";
	const title = useRef<HTMLHeadingElement>(null);

	useEffect(() => {
		if (asDialog) title.current?.focus();
	}, [asDialog]);

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
		<Container
			aria-labelledby="onboarding-title"
			aria-modal={asDialog || undefined}
			className={
				asDialog ? "onboarding onboarding-dialog" : "shell auth onboarding"
			}
			role={asDialog ? "dialog" : undefined}
		>
			<h1
				id="onboarding-title"
				ref={title}
				tabIndex={asDialog ? -1 : undefined}
			>
				{t("app.title")}
			</h1>
			{onClose ? (
				<button onClick={onClose} type="button">
					{t("onboarding.close")}
				</button>
			) : null}
			{step === "microphone" ? (
				<>
					<h2>{t("onboarding.microphone.title")}</h2>
					<p>{t("onboarding.microphone.body")}</p>
					<button onClick={() => void requestMicrophone()} type="button">
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
					<button
						disabled={microphone !== "granted"}
						onClick={() => setStep("delivery")}
						type="button"
					>
						{t("onboarding.continue")}
					</button>
				</>
			) : null}
			{step === "delivery" ? (
				<>
					<h2>{t("onboarding.delivery.title")}</h2>
					<p>{t("onboarding.delivery.body")}</p>
					<p>{t("onboarding.delivery.extension")}</p>
					<p>{t("onboarding.delivery.clipboardNote")}</p>
					<button onClick={() => setStep("provider")} type="button">
						{t("onboarding.continue")}
					</button>
				</>
			) : null}
			{step === "provider" ? (
				<>
					<h2>{t("onboarding.provider.title")}</h2>
					<p>{t("onboarding.provider.cloud")}</p>
					<p>{t("onboarding.provider.noSubstitution")}</p>
					<label className="checkbox" htmlFor="onboarding-never-save">
						<input
							checked={retention === "never"}
							id="onboarding-never-save"
							onChange={(event) =>
								setRetention(event.target.checked ? "never" : "forever")
							}
							type="checkbox"
						/>
						{t("onboarding.retention.neverChoice")}
					</label>
					{retention === "never" ? (
						<p>{t("onboarding.retention.neverNote")}</p>
					) : null}
					<button onClick={() => onComplete(retention)} type="button">
						{t("onboarding.continueToSignIn")}
					</button>
				</>
			) : null}
		</Container>
	);
}
