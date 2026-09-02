import { sendMessageUntilAcknowledged } from "./bridge";
import type { AudioSource } from "./types";

type FinalCaptureMessage =
	| { captureId: string; error: string; type: "capture-error" }
	| { captureId: string; source: AudioSource; type: "capture-persisted" };

export async function sendFinalCaptureMessage(message: FinalCaptureMessage) {
	await sendMessageUntilAcknowledged(message);
	await sendMessageUntilAcknowledged({
		captureId: message.captureId,
		type: "close-offscreen",
	});
}
