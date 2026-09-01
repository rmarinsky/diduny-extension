import { afterEach, expect, test } from "bun:test";
import { installDeliveryBridge } from "./page-bridge";

const originalDocument = Object.getOwnPropertyDescriptor(
	globalThis,
	"document",
);
const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");

afterEach(() => {
	globalThis.__didunyDeliveryBridge = undefined;

	if (originalDocument) {
		Object.defineProperty(globalThis, "document", originalDocument);
	} else {
		globalThis.document = undefined;
	}

	if (originalChrome) {
		Object.defineProperty(globalThis, "chrome", originalChrome);
	} else {
		globalThis.chrome = undefined;
	}
});

test("inserts completed dictation into the focused text control only for extension messages", () => {
	const inputEvents = [];
	const textarea = {
		tagName: "TEXTAREA",
		value: "Hello world",
		selectionStart: 6,
		selectionEnd: 11,
		readOnly: false,
		disabled: false,
		isConnected: true,
		setSelectionRange(start, end) {
			this.selectionStart = start;
			this.selectionEnd = end;
		},
		dispatchEvent(event) {
			inputEvents.push(event);
			return true;
		},
	};
	const nextInput = {
		tagName: "INPUT",
		type: "text",
		value: "Second field",
		selectionStart: 7,
		selectionEnd: 12,
		readOnly: false,
		disabled: false,
		isConnected: true,
		setSelectionRange(start, end) {
			this.selectionStart = start;
			this.selectionEnd = end;
		},
		dispatchEvent(event) {
			inputEvents.push(event);
			return true;
		},
	};

	let listener;
	const page = { activeElement: textarea, body: null };
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		writable: true,
		value: page,
	});
	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		writable: true,
		value: {
			runtime: {
				id: "diduny-test",
				onMessage: {
					addListener(callback) {
						listener = callback;
					},
				},
			},
		},
	});

	expect(installDeliveryBridge()).toEqual({ ready: true });
	expect(listener).toBeDefined();

	listener(
		{ type: "diduny:deliver-transcript", text: "Dictation" },
		{ id: "page-script" },
		() => {},
	);
	expect(textarea.value).toBe("Hello world");

	page.activeElement = nextInput;
	expect(installDeliveryBridge()).toEqual({ ready: true });

	let response;
	listener(
		{ type: "diduny:deliver-transcript", text: "Dictation" },
		{ id: "diduny-test" },
		(value) => {
			response = value;
		},
	);

	expect(response).toEqual({ inserted: true });
	expect(textarea.value).toBe("Hello world");
	expect(nextInput.value).toBe("Second Dictation");
	expect(nextInput.selectionStart).toBe(16);
	expect(nextInput.selectionEnd).toBe(16);
	expect(inputEvents).toHaveLength(1);
	expect(inputEvents[0]?.type).toBe("input");
});

test("delivers to an email input without a text-selection API", () => {
	const input = {
		tagName: "INPUT",
		type: "email",
		value: "hello@",
		selectionStart: null,
		selectionEnd: null,
		readOnly: false,
		disabled: false,
		isConnected: true,
		setSelectionRange() {
			throw new Error("Email inputs do not support text selection");
		},
		dispatchEvent() {
			return true;
		},
	};
	let listener;
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		writable: true,
		value: { activeElement: input, body: null },
	});
	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		writable: true,
		value: {
			runtime: {
				id: "diduny-test",
				onMessage: {
					addListener(callback) {
						listener = callback;
					},
				},
			},
		},
	});

	expect(installDeliveryBridge()).toEqual({ ready: true });
	listener(
		{ type: "diduny:deliver-transcript", text: "example.com" },
		{ id: "diduny-test" },
		() => {},
	);

	expect(input.value).toBe("hello@example.com");
});
