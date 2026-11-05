import { afterEach, expect, test } from "bun:test";
import { deliverToQuill, installDeliveryBridge } from "./page-bridge";

const originalDocument = Object.getOwnPropertyDescriptor(
	globalThis,
	"document",
);
const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
const originalLocation = Object.getOwnPropertyDescriptor(
	globalThis,
	"location",
);

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

	if (originalLocation) {
		Object.defineProperty(globalThis, "location", originalLocation);
	} else {
		globalThis.location = undefined;
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
	const deliveryMarkers = new Map();
	const documentElement = {
		getAttribute(name) {
			return deliveryMarkers.get(name) ?? null;
		},
		setAttribute(name, value) {
			deliveryMarkers.set(name, value);
		},
	};

	let listener;
	const page = { activeElement: textarea, body: null, documentElement };
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
	Object.defineProperty(globalThis, "location", {
		configurable: true,
		writable: true,
		value: { origin: "https://frame.example.test" },
	});

	expect(installDeliveryBridge()).toEqual({
		origin: "https://frame.example.test",
		ready: true,
	});
	expect(listener).toBeDefined();

	listener(
		{ type: "diduny:deliver-transcript", text: "Dictation" },
		{ id: "page-script" },
		() => {},
	);
	expect(textarea.value).toBe("Hello world");

	page.activeElement = nextInput;
	expect(installDeliveryBridge()).toEqual({
		origin: "https://frame.example.test",
		ready: true,
	});

	let response;
	listener(
		{
			deliveryId: "capture-1",
			type: "diduny:deliver-transcript",
			text: "Dictation",
		},
		{ id: "diduny-test" },
		(value) => {
			response = value;
		},
	);
	listener(
		{
			deliveryId: "capture-1",
			type: "diduny:deliver-transcript",
			text: "Dictation",
		},
		{ id: "diduny-test" },
		() => {},
	);

	expect(response).toEqual({ inserted: true });
	expect(textarea.value).toBe("Hello world");
	expect(nextInput.value).toBe("Second Dictation");
	expect(nextInput.selectionStart).toBe(16);
	expect(nextInput.selectionEnd).toBe(16);
	expect(inputEvents).toHaveLength(1);
	expect(inputEvents[0]?.type).toBe("input");
	expect(documentElement.getAttribute("data-diduny-delivery-id")).toBe(
		"capture-1",
	);
});

test("shares the recovered delivery marker with Quill's MAIN world", () => {
	const insertions = [];
	const target = {
		closest() {
			return {
				__quill: {
					getSelection: () => ({ index: 0 }),
					insertText: (...args) => insertions.push(args),
				},
			};
		},
		isConnected: true,
	};
	const attributes = new Map();
	const documentElement = {
		getAttribute(name) {
			return attributes.get(name) ?? null;
		},
		setAttribute(name, value) {
			attributes.set(name, value);
		},
	};
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { documentElement, querySelector: () => target },
		writable: true,
	});

	documentElement.setAttribute("data-diduny-delivery-id", "capture-1");
	expect(deliverToQuill("Recovered", "capture-1")).toEqual({ inserted: true });
	expect(deliverToQuill("Recovered", "capture-1")).toEqual({ inserted: true });
	expect(insertions).toHaveLength(0);
	expect(deliverToQuill("New", "capture-2")).toEqual({ inserted: true });
	expect(deliverToQuill("New", "capture-2")).toEqual({ inserted: true });
	expect(insertions).toHaveLength(1);
});

function installChrome() {
	const bridge = {};
	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		writable: true,
		value: {
			runtime: {
				id: "diduny-test",
				onMessage: {
					addListener(callback) {
						bridge.listener = callback;
					},
				},
			},
		},
	});
	return bridge;
}

function textarea(value) {
	return {
		tagName: "TEXTAREA",
		value,
		selectionStart: value.length,
		selectionEnd: value.length,
		readOnly: false,
		disabled: false,
		isConnected: true,
		setSelectionRange(start, end) {
			this.selectionStart = start;
			this.selectionEnd = end;
		},
		dispatchEvent() {
			return true;
		},
	};
}

test("does not pick another box on the page when nothing is focused", () => {
	const notes = {
		tagName: "DIV",
		isContentEditable: true,
		getAttribute: () => "true",
		contains: (node) => node === notes,
	};
	const body = {
		tagName: "BODY",
		isContentEditable: false,
		getAttribute: () => null,
		closest: () => null,
		contains: () => true,
		querySelector: (selector) =>
			selector === '[contenteditable="true"]' ? notes : null,
	};
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		writable: true,
		value: { activeElement: body, body: null },
	});
	installChrome();

	expect(installDeliveryBridge()).toEqual({
		ready: false,
		reason: "no-text-field",
	});
});

test("inserts at the field's current caret, after text typed while recording", () => {
	const field = textarea("");
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		writable: true,
		value: { activeElement: field, body: null },
	});
	const bridge = installChrome();
	expect(installDeliveryBridge()).toMatchObject({ ready: true });

	field.value = "typed during recording";
	field.selectionStart = field.value.length;
	field.selectionEnd = field.value.length;
	bridge.listener(
		{ type: "diduny:deliver-transcript", text: "Mock transcript" },
		{ id: "diduny-test" },
		() => {},
	);

	expect(field.value).toBe("typed during recordingMock transcript");
});

test("a field disabled or made read-only during the recording gets nothing and reports it", () => {
	for (const change of ["disabled", "readOnly"]) {
		globalThis.__didunyDeliveryBridge = undefined;
		const field = textarea("before ");
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			writable: true,
			value: { activeElement: field, body: null },
		});
		const bridge = installChrome();
		expect(installDeliveryBridge()).toMatchObject({ ready: true });

		field[change] = true;
		let response;
		bridge.listener(
			{ type: "diduny:deliver-transcript", text: "Mock transcript" },
			{ id: "diduny-test" },
			(value) => {
				response = value;
			},
		);

		expect(response).toEqual({ inserted: false, reason: "target-unavailable" });
		expect(field.value).toBe("before ");
	}
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

	expect(installDeliveryBridge()).toMatchObject({ ready: true });
	listener(
		{ type: "diduny:deliver-transcript", text: "example.com" },
		{ id: "diduny-test" },
		() => {},
	);

	expect(input.value).toBe("hello@example.com");
});
