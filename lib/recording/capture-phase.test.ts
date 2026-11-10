import { expect, test } from "bun:test";
import { shouldReportGlobalCaptureError } from "./capture-phase";

test("only a global startup error becomes a terminal capture failure", () => {
	expect(shouldReportGlobalCaptureError("starting")).toBeTrue();
	expect(shouldReportGlobalCaptureError("recording")).toBeFalse();
	expect(shouldReportGlobalCaptureError("finalizing")).toBeFalse();
	expect(shouldReportGlobalCaptureError("idle")).toBeFalse();
});
