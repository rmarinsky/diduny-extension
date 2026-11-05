import {
	DidunyError,
	type DidunyErrorCode,
	isDidunyError,
} from "../../src/core/errors";
import { RealtimeSessionError } from "../../src/core/realtime-session";

type Translate = (key: string, options?: Record<string, unknown>) => string;

function numberField(value: unknown) {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function errorCode(value: unknown) {
	return value && typeof value === "object" && "error" in value
		? (value as { error?: unknown }).error
		: undefined;
}

export function errorFromResponse(status: number, body: unknown) {
	const code = errorCode(body);
	if (status === 401 || code === "unauthenticated")
		return new DidunyError("authentication_failed", { body, status });
	if (status === 402) {
		const fields = body && typeof body === "object" ? body : {};
		return new DidunyError("quota_exhausted", {
			limitHours: numberField((fields as { limitHours?: unknown }).limitHours),
			status,
			usedHours: numberField((fields as { usedHours?: unknown }).usedHours),
		});
	}
	if (status === 502 && code === "upstream_unreachable")
		return new DidunyError("proxy_unreachable", { status });
	return new DidunyError("request_rejected", { body, status });
}

export function isInvalidEmailError(error: unknown) {
	return (
		isDidunyError(error) &&
		error.details.status === 400 &&
		errorCode(error.details.body) === "invalid_email"
	);
}

/** The sign-in service refused the code: wrong, expired, or already used. */
export function isIncorrectOtpError(error: unknown) {
	return (
		isDidunyError(error) &&
		error.details.status === 401 &&
		errorCode(error.details.body) === "otp_verification_failed"
	);
}

export function localProcessUnavailable(error: unknown) {
	return isDidunyError(error)
		? error
		: new DidunyError("local_process_unreachable");
}

function typedCode(error: unknown): DidunyErrorCode | undefined {
	if (isDidunyError(error)) return error.code;
	if (!(error instanceof RealtimeSessionError)) return undefined;
	if (error.code === "quota_exhausted") return "quota_exhausted";
	return "realtime_unavailable";
}

export function userErrorMessage(error: unknown, t: Translate) {
	const code = typedCode(error);
	if (code === "quota_exhausted") {
		const details = isDidunyError(error) ? error.details : {};
		return t("errors.quotaExceeded", {
			limit: details.limitHours ?? "?",
			used: details.usedHours ?? "?",
		});
	}
	if (code === "local_process_unreachable")
		return t("errors.localProcessUnavailable");
	if (code === "proxy_unreachable") return t("errors.proxyUnavailable");
	if (code === "authentication_failed") return t("errors.authenticationFailed");
	if (code === "realtime_unavailable") return t("errors.realtimeUnavailable");
	if (code === "remote_acquisition_unavailable_on_web")
		return t("errors.remoteAcquisitionUnavailableOnWeb");
	return t("errors.requestRejected");
}

/** Paste-in translation failures, worded for the paste panel. */
export function pastedTranslationErrorMessage(error: unknown, t: Translate) {
	const code = typedCode(error);
	if (code === "empty_result") return t("status.translationNoText");
	if (
		code === undefined ||
		code === "local_process_unreachable" ||
		code === "request_rejected"
	)
		return t("status.couldNotTranslate");
	return userErrorMessage(error, t);
}
