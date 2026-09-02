import type { DeliveryEditor } from "./delivery-session";

export type DeliveryUnavailableReason = "no-text-field" | "unsupported-editor";

export type DeliveryPreparation =
	| { editor?: DeliveryEditor; origin: string; ready: true }
	| { ready: false; reason: DeliveryUnavailableReason };

export type DeliveryResult =
	| { inserted: true }
	| { inserted: false; reason: "target-unavailable" };

export function deliverToQuill(text: string): DeliveryResult {
	type QuillEditor = {
		getLength?: () => number;
		getSelection?: (focus?: boolean) => { index?: number } | null;
		insertText?: (index: number, value: string, source?: string) => void;
	};
	const target = document.querySelector<HTMLElement>(
		'[data-diduny-delivery-target="quill"]',
	);
	const container = target?.closest(".ql-container") as
		| (Element & { __quill?: QuillEditor })
		| null;
	const quill = container?.__quill;
	if (!target?.isConnected || !quill?.insertText)
		return { inserted: false, reason: "target-unavailable" };
	const selection = quill.getSelection?.(true);
	const index =
		typeof selection?.index === "number"
			? selection.index
			: Math.max(
					0,
					(quill.getLength?.() ?? target.textContent?.length ?? 0) - 1,
				);
	try {
		quill.insertText(index, text, "user");
		return { inserted: true };
	} catch {
		return { inserted: false, reason: "target-unavailable" };
	}
}

/**
 * Runs in the page's isolated extension world via chrome.scripting.executeScript.
 * It deliberately contains all runtime helpers so Chrome can serialize it without
 * relying on imports from the service worker bundle.
 */
export function installDeliveryBridge(): DeliveryPreparation {
	type TextControl = HTMLInputElement | HTMLTextAreaElement;
	type ContentEditable = HTMLElement;
	type DeliveryTarget = TextControl | ContentEditable;
	type EditorAdapter = DeliveryEditor;
	type BridgeState = {
		editor?: EditorAdapter;
		range?: Range;
		selectionEnd: number;
		selectionStart: number;
		target: DeliveryTarget | null;
	};

	const stateHost = globalThis as typeof globalThis & {
		__didunyDeliveryBridge?: BridgeState;
	};
	const pageOrigin = globalThis.location?.origin ?? "";
	const statusId = "__diduny-delivery-status";
	const targetAttribute = "data-diduny-delivery-target";
	let state = stateHost.__didunyDeliveryBridge;

	function isTextControl(element: Element | null): element is TextControl {
		if (!element) return false;

		const control = element as TextControl;
		if (control.tagName !== "TEXTAREA" && control.tagName !== "INPUT") {
			return false;
		}
		if (control.disabled || control.readOnly) return false;

		if (control.tagName === "INPUT") {
			const inputType = (control as HTMLInputElement).type.toLowerCase();
			if (!["text", "search", "url", "tel", "email"].includes(inputType)) {
				return false;
			}
		}

		return typeof control.value === "string";
	}

	function editableNode(element: Element | null): ContentEditable | null {
		if (!element) return null;
		const candidate = element as ContentEditable & {
			querySelector?: (selector: string) => Element | null;
		};
		if (
			candidate.isContentEditable ||
			candidate.getAttribute?.("contenteditable") === "true"
		)
			return candidate;
		const nested = candidate.querySelector?.('[contenteditable="true"]');
		return nested ? editableNode(nested) : null;
	}

	function supportedEditorTarget(
		element: Element | null,
	): { editor: EditorAdapter; target: ContentEditable } | null {
		if (!element) return null;
		const candidate = element as Element & {
			closest?: (selector: string) => Element | null;
		};
		for (const [editor, selector] of [
			["notion", '[data-content-editable-leaf="true"]'],
			["linear", '[data-placeholder][contenteditable="true"]'],
			["slack", '[data-qa="message_input"]'],
			["prosemirror", '.ProseMirror[contenteditable="true"]'],
			["lexical", '[data-lexical-editor="true"]'],
			["quill", '.ql-editor[contenteditable="true"]'],
		] as const) {
			const target = editableNode(candidate.closest?.(selector) ?? null);
			if (target) return { editor, target };
		}
		const target = editableNode(
			candidate.closest?.('[contenteditable="true"]') ?? candidate,
		);
		return target ? { editor: "contenteditable", target } : null;
	}

	function isCanvasEditor(element: Element | null) {
		const candidate = element as Element & {
			closest?: (selector: string) => Element | null;
			matches?: (selector: string) => boolean;
		};
		return Boolean(
			candidate?.matches?.(".kix-appview-editor") ||
				candidate?.closest?.(".kix-appview-editor"),
		);
	}

	function setStatus(text: string) {
		if (!document.body) return;

		let status = document.getElementById(statusId);
		if (!status) {
			status = document.createElement("div");
			status.id = statusId;
			status.setAttribute("role", "status");
			status.setAttribute("aria-live", "polite");
			Object.assign(status.style, {
				position: "fixed",
				right: "16px",
				bottom: "16px",
				zIndex: "2147483647",
				padding: "8px 12px",
				borderRadius: "999px",
				background: "#111827",
				color: "#ffffff",
				font: "500 13px system-ui, sans-serif",
				boxShadow: "0 2px 8px rgb(0 0 0 / 25%)",
				pointerEvents: "none",
			});
			document.body.append(status);
		}
		status.textContent = text;
	}

	function clearStatus() {
		if (!document.body) return;
		document.getElementById(statusId)?.remove();
		const trackedTarget = stateHost.__didunyDeliveryBridge?.target as
			| (DeliveryTarget & { removeAttribute?: (name: string) => void })
			| undefined;
		trackedTarget?.removeAttribute?.(targetAttribute);
	}

	function updateTarget(target: DeliveryTarget, editor?: EditorAdapter) {
		const previousTarget = stateHost.__didunyDeliveryBridge?.target as
			| (DeliveryTarget & { removeAttribute?: (name: string) => void })
			| undefined;
		if (previousTarget !== target)
			previousTarget?.removeAttribute?.(targetAttribute);
		const attributes = target as DeliveryTarget & {
			removeAttribute?: (name: string) => void;
			setAttribute?: (name: string, value: string) => void;
		};
		if (editor === "quill") attributes.setAttribute?.(targetAttribute, editor);
		else attributes.removeAttribute?.(targetAttribute);
		if (!isTextControl(target)) {
			const selection = document.getSelection?.();
			const range =
				selection &&
				selection.rangeCount > 0 &&
				target.contains(selection.anchorNode)
					? selection.getRangeAt(0).cloneRange()
					: undefined;
			state = { editor, range, selectionEnd: 0, selectionStart: 0, target };
			stateHost.__didunyDeliveryBridge = state;
			return;
		}
		let start = target.value.length;
		let end = start;
		try {
			start = target.selectionStart ?? start;
			end = target.selectionEnd ?? start;
		} catch {
			// Some text-like controls, such as email inputs, have no selection API.
		}
		state = { target, selectionStart: start, selectionEnd: end };
		stateHost.__didunyDeliveryBridge = state;
	}

	function dispatchBeforeInput(target: ContentEditable, text: string) {
		try {
			return target.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					composed: true,
					data: text,
					inputType: "insertText",
				}),
			);
		} catch {
			return target.dispatchEvent(
				new Event("beforeinput", {
					bubbles: true,
					cancelable: true,
					composed: true,
				}),
			);
		}
	}

	function dispatchInput(target: ContentEditable, text: string) {
		try {
			target.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					composed: true,
					data: text,
					inputType: "insertText",
				}),
			);
		} catch {
			target.dispatchEvent(
				new Event("input", { bubbles: true, composed: true }),
			);
		}
	}

	function insertContentEditable(
		target: ContentEditable,
		text: string,
		range?: Range,
	): DeliveryResult {
		if (!target.isConnected)
			return { inserted: false, reason: "target-unavailable" };
		target.focus?.();
		if (!dispatchBeforeInput(target, text)) return { inserted: true };
		const selection = document.getSelection?.();
		let insertionRange = range;
		if (!insertionRange || !target.contains(insertionRange.startContainer)) {
			insertionRange = document.createRange();
			insertionRange.selectNodeContents(target);
			insertionRange.collapse(false);
		}
		try {
			selection?.removeAllRanges();
			selection?.addRange(insertionRange);
			if (document.execCommand?.("insertText", false, text)) {
				dispatchInput(target, text);
				return { inserted: true };
			}
		} catch {
			// Fall back to a DOM Range when an editor blocks execCommand.
		}
		insertionRange.deleteContents();
		const node = document.createTextNode(text);
		insertionRange.insertNode(node);
		insertionRange.setStartAfter(node);
		insertionRange.collapse(true);
		selection?.removeAllRanges();
		selection?.addRange(insertionRange);
		dispatchInput(target, text);
		return { inserted: true };
	}

	function insertText(text: string): DeliveryResult {
		const currentState = stateHost.__didunyDeliveryBridge;
		const target = currentState?.target;
		if (!target || !target.isConnected) {
			return { inserted: false, reason: "target-unavailable" };
		}
		if (!isTextControl(target))
			return insertContentEditable(target, text, currentState.range);

		const value = target.value;
		const selectionStart = Math.min(
			Math.max(currentState.selectionStart, 0),
			value.length,
		);
		const selectionEnd = Math.min(
			Math.max(currentState.selectionEnd, selectionStart),
			value.length,
		);
		const nextValue = `${value.slice(0, selectionStart)}${text}${value.slice(selectionEnd)}`;
		const nativeControlConstructor =
			target.tagName === "TEXTAREA"
				? globalThis.HTMLTextAreaElement
				: globalThis.HTMLInputElement;
		const nativeSetter = nativeControlConstructor
			? Object.getOwnPropertyDescriptor(
					nativeControlConstructor.prototype,
					"value",
				)?.set
			: undefined;

		if (nativeSetter) {
			nativeSetter.call(target, nextValue);
		} else {
			target.value = nextValue;
		}

		const cursor = selectionStart + text.length;
		try {
			target.setSelectionRange(cursor, cursor);
		} catch {
			// The value was inserted; no cursor update is available for this control.
		}
		try {
			target.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					composed: true,
					inputType: "insertText",
					data: text,
				}),
			);
		} catch {
			target.dispatchEvent(
				new Event("input", { bubbles: true, composed: true }),
			);
		}

		return { inserted: true };
	}

	if (!state) {
		state = { target: null, selectionStart: 0, selectionEnd: 0 };
		stateHost.__didunyDeliveryBridge = state;
		chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
			if (
				sender.id !== chrome.runtime.id ||
				!message ||
				typeof message !== "object"
			) {
				return false;
			}

			const payload = message as {
				type?: unknown;
				text?: unknown;
				status?: unknown;
			};
			if (payload.type === "diduny:delivery-status") {
				if (payload.status === "processing") {
					setStatus("Diduny is finishing dictation");
				} else if (payload.status === "clear") {
					clearStatus();
				}
				return false;
			}

			if (
				payload.type !== "diduny:deliver-transcript" ||
				typeof payload.text !== "string"
			) {
				return false;
			}

			const result = insertText(payload.text);
			if (!result.inserted) {
				setStatus("Diduny could not insert into the original text field");
			}
			sendResponse(result);
			return false;
		});
	}

	const target = document.activeElement;
	if (!isTextControl(target)) {
		const editable = supportedEditorTarget(target);
		if (editable) {
			updateTarget(editable.target, editable.editor);
			setStatus("Diduny is recording");
			return { editor: editable.editor, origin: pageOrigin, ready: true };
		}
		return {
			ready: false,
			reason: isCanvasEditor(target) ? "unsupported-editor" : "no-text-field",
		};
	}

	updateTarget(target);
	setStatus("Diduny is recording");
	return { origin: pageOrigin, ready: true };
}
