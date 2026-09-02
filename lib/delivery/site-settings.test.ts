import { afterEach, expect, test } from "bun:test";
import {
	DISABLED_DELIVERY_ORIGINS_STORAGE_KEY,
	deliveryOrigin,
	setDeliveryEnabled,
} from "./site-settings";

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");

afterEach(() => {
	if (originalChrome) {
		Object.defineProperty(globalThis, "chrome", originalChrome);
	} else {
		Reflect.deleteProperty(globalThis, "chrome");
	}
});

test("uses one permission key per web origin and rejects non-web pages", () => {
	expect(deliveryOrigin("https://linear.app/team/issue")).toBe(
		"https://linear.app",
	);
	expect(deliveryOrigin("http://localhost:4317/fixture")).toBe(
		"http://localhost:4317",
	);
	expect(deliveryOrigin("chrome://extensions")).toBeNull();
	expect(deliveryOrigin("file:///tmp/note.txt")).toBeNull();
});

test("revokes a site's persistent permission when direct delivery is disabled", async () => {
	const stored: Record<string, unknown> = {};
	const removed: unknown[] = [];
	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		value: {
			permissions: {
				async contains() {
					return true;
				},
				async remove(request: unknown) {
					removed.push(request);
					return true;
				},
			},
			storage: {
				local: {
					async get(key: string) {
						return { [key]: stored[key] };
					},
					async set(next: Record<string, unknown>) {
						Object.assign(stored, next);
					},
				},
			},
		},
	});

	expect(await setDeliveryEnabled("https://linear.app/team/issue", false)).toBe(
		true,
	);
	expect(removed).toEqual([{ origins: ["https://linear.app/*"] }]);
	expect(stored[DISABLED_DELIVERY_ORIGINS_STORAGE_KEY]).toEqual([
		"https://linear.app",
	]);
});

test("keeps the no-delivery guard when a required BFF origin cannot be revoked", async () => {
	const stored: Record<string, unknown> = {};
	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		value: {
			permissions: {
				async remove() {
					throw new Error("Required permissions cannot be removed");
				},
			},
			storage: {
				local: {
					async get(key: string) {
						return { [key]: stored[key] };
					},
					async set(next: Record<string, unknown>) {
						Object.assign(stored, next);
					},
				},
			},
		},
	});

	expect(await setDeliveryEnabled("http://localhost:4317", false)).toBe(true);
	expect(stored[DISABLED_DELIVERY_ORIGINS_STORAGE_KEY]).toEqual([
		"http://localhost:4317",
	]);
});
