export type DidunyErrorCode =
	| "authentication_failed"
	| "local_process_unreachable"
	| "proxy_unreachable"
	| "quota_exhausted"
	| "realtime_unavailable"
	| "remote_acquisition_unavailable_on_web"
	| "request_rejected";

export interface DidunyErrorDetails {
	limitHours?: number;
	status?: number;
	usedHours?: number;
}

export class DidunyError extends Error {
	constructor(
		readonly code: DidunyErrorCode,
		readonly details: DidunyErrorDetails = {},
	) {
		super(code);
		this.name = "DidunyError";
	}
}

export function isDidunyError(error: unknown): error is DidunyError {
	return error instanceof DidunyError;
}

export function remoteAcquisitionUnavailableOnWeb() {
	// #017 and #034: the BFF must not become a server-side remote-media extractor.
	return new DidunyError("remote_acquisition_unavailable_on_web");
}
