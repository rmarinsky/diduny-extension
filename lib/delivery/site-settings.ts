export const DISABLED_DELIVERY_ORIGINS_STORAGE_KEY =
	"didunyDisabledDeliveryOrigins";

export function deliveryOrigin(value: string): string | null {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.origin
			: null;
	} catch {
		return null;
	}
}

function storedOrigins(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((origin): origin is string => typeof origin === "string")
		: [];
}

export async function getDisabledDeliveryOrigins(): Promise<string[]> {
	const stored = await chrome.storage.local.get(
		DISABLED_DELIVERY_ORIGINS_STORAGE_KEY,
	);
	return storedOrigins(stored[DISABLED_DELIVERY_ORIGINS_STORAGE_KEY]).sort();
}

export async function isDeliveryEnabled(url: string): Promise<boolean> {
	const origin = deliveryOrigin(url);
	if (!origin) return false;
	const stored = await chrome.storage.local.get(
		DISABLED_DELIVERY_ORIGINS_STORAGE_KEY,
	);
	return !storedOrigins(stored[DISABLED_DELIVERY_ORIGINS_STORAGE_KEY]).includes(
		origin,
	);
}

export async function setDeliveryEnabled(url: string, enabled: boolean) {
	const origin = deliveryOrigin(url);
	if (!origin) return false;
	const permission = { origins: [`${origin}/*`] };
	if (!enabled) {
		// localhost is required for the local BFF and cannot be removed, but the
		// disabled-origin guard still prevents page delivery there.
		await chrome.permissions.remove(permission).catch(() => undefined);
	}
	const stored = await chrome.storage.local.get(
		DISABLED_DELIVERY_ORIGINS_STORAGE_KEY,
	);
	const origins = new Set(
		storedOrigins(stored[DISABLED_DELIVERY_ORIGINS_STORAGE_KEY]),
	);
	if (enabled) origins.delete(origin);
	else origins.add(origin);
	await chrome.storage.local.set({
		[DISABLED_DELIVERY_ORIGINS_STORAGE_KEY]: [...origins].sort(),
	});
	return true;
}

export async function hasDeliveryPermission(url: string): Promise<boolean> {
	const origin = deliveryOrigin(url);
	return origin
		? chrome.permissions.contains({ origins: [`${origin}/*`] })
		: false;
}

export async function requestDeliveryPermission(url: string): Promise<boolean> {
	const origin = deliveryOrigin(url);
	if (!origin) return false;
	const origins = [`${origin}/*`];
	if (await hasDeliveryPermission(url)) return true;
	return chrome.permissions.request({ origins });
}
