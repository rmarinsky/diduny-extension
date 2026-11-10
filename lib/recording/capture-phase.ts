export type CapturePhase = "idle" | "starting" | "recording" | "finalizing";

export function shouldReportGlobalCaptureError(phase: CapturePhase) {
	return phase === "starting";
}
