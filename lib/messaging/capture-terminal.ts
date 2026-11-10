import { sendMessageUntilAcknowledged } from "./bridge";
import type { AudioSource, Message } from "./types";

type FinalCaptureMessage =
	| Extract<Message, { type: "capture-error" }>
	| { captureId: string; source: AudioSource; type: "capture-persisted" };

export async function sendFinalCaptureMessage(message: FinalCaptureMessage) {
	await sendMessageUntilAcknowledged(message);
	await sendMessageUntilAcknowledged({
		captureId: message.captureId,
		type: "close-offscreen",
	});
}
