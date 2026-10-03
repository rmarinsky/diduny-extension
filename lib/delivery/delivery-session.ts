export type DeliveryEditor =
	| "contenteditable"
	| "lexical"
	| "linear"
	| "notion"
	| "prosemirror"
	| "quill"
	| "slack";

export interface DeliverySession {
	/** The page the field lived in; a navigation in the same frame never receives the text. */
	documentId?: string;
	editor?: DeliveryEditor;
	tabId: number;
	frameId: number;
	origin: string;
}

function isDeliveryEditor(value: unknown): value is DeliveryEditor {
	return [
		"contenteditable",
		"lexical",
		"linear",
		"notion",
		"prosemirror",
		"quill",
		"slack",
	].includes(value as DeliveryEditor);
}

export function selectDeliverySession(
	tabId: number,
	results: readonly {
		documentId?: string;
		frameId: number;
		result?: { editor?: DeliveryEditor; origin?: string; ready?: boolean };
	}[],
): DeliverySession | undefined {
	const target = results.find((result) => result.result?.ready === true);
	const origin = target?.result?.origin;
	return target && typeof origin === "string" && /^https?:\/\//.test(origin)
		? {
				...(typeof target.documentId === "string" && target.documentId
					? { documentId: target.documentId }
					: {}),
				...(isDeliveryEditor(target.result?.editor)
					? { editor: target.result.editor }
					: {}),
				frameId: target.frameId,
				origin,
				tabId,
			}
		: undefined;
}

export function isDeliverySession(value: unknown): value is DeliverySession {
	if (!value || typeof value !== "object") return false;
	const session = value as Partial<DeliverySession>;
	return (
		typeof session.tabId === "number" &&
		typeof session.frameId === "number" &&
		typeof session.origin === "string" &&
		Number.isInteger(session.tabId) &&
		Number.isInteger(session.frameId) &&
		session.tabId >= 0 &&
		session.frameId >= 0 &&
		(session.editor === undefined || isDeliveryEditor(session.editor)) &&
		(session.documentId === undefined ||
			typeof session.documentId === "string") &&
		/^https?:\/\//.test(session.origin)
	);
}
