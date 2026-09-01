export type DeliveryPreparation =
	| { ready: true }
	| { ready: false; reason: "no-text-field" };

export type DeliveryResult =
	| { inserted: true }
	| { inserted: false; reason: "target-unavailable" };

/**
 * Runs in the page's isolated extension world via chrome.scripting.executeScript.
 * It deliberately contains all runtime helpers so Chrome can serialize it without
 * relying on imports from the service worker bundle.
 */
export function installDeliveryBridge(): DeliveryPreparation {
	type TextControl = HTMLInputElement | HTMLTextAreaElement;
	type BridgeState = {
		target: TextControl | null;
		selectionStart: number;
		selectionEnd: number;
	};

	const stateHost = globalThis as typeof globalThis & {
		__didunyDeliveryBridge?: BridgeState;
	};
	const statusId = "__diduny-delivery-status";
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
			if (!["text", "search", "url", "tel"].includes(inputType)) {
				return false;
			}
		}

		return typeof control.value === "string";
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
	}

	function updateTarget(target: TextControl) {
		const start = target.selectionStart ?? target.value.length;
		const end = target.selectionEnd ?? start;
		state = { target, selectionStart: start, selectionEnd: end };
		stateHost.__didunyDeliveryBridge = state;
	}

	function insertText(text: string): DeliveryResult {
		const currentState = stateHost.__didunyDeliveryBridge;
		const target = currentState?.target;
		if (!target || !isTextControl(target) || !target.isConnected) {
			return { inserted: false, reason: "target-unavailable" };
		}

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
		target.setSelectionRange(cursor, cursor);
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
		setStatus("Diduny: focus a text field before dictating");
		return { ready: false, reason: "no-text-field" };
	}

	updateTarget(target);
	setStatus("Diduny is recording");
	return { ready: true };
}
