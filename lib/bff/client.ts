export const DEFAULT_BFF_ORIGIN = "http://localhost:3000";
export const BFF_ORIGIN_STORAGE_KEY = "didunyBffOrigin";

export function normalizeBffOrigin(value: string): string {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error("BFF origin must be a valid URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("BFF origin must use http or https");
	}
	if (
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new Error("BFF origin only; do not include a path or credentials");
	}
	return url.origin;
}

export function normalizeLocalBffOrigin(value: string): string {
	const origin = normalizeBffOrigin(value);
	const hostname = new URL(origin).hostname;
	if (hostname !== "localhost")
		throw new Error(
			"Extension BFF origin must use localhost for secure cookies",
		);
	return origin;
}

export function bffUrl(path: string, origin = DEFAULT_BFF_ORIGIN): string {
	if (!path.startsWith("/bff/")) {
		throw new Error("BFF paths must start with /bff/");
	}
	return `${normalizeBffOrigin(origin)}${path}`;
}

export function bffWebSocketUrl(origin = DEFAULT_BFF_ORIGIN): string {
	const url = new URL(normalizeBffOrigin(origin));
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.pathname = "/bff/realtime";
	return url.href;
}

export function bffExtensionWebSocketUrl(origin = DEFAULT_BFF_ORIGIN): string {
	const url = new URL(normalizeBffOrigin(origin));
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.pathname = "/bff/extension/realtime";
	return url.href;
}

export async function getBffOrigin(): Promise<string> {
	const stored = await chrome.storage.local.get(BFF_ORIGIN_STORAGE_KEY);
	const value = stored[BFF_ORIGIN_STORAGE_KEY];
	return typeof value === "string"
		? normalizeBffOrigin(value)
		: DEFAULT_BFF_ORIGIN;
}

export async function setBffOrigin(value: string): Promise<string> {
	const origin = normalizeLocalBffOrigin(value);
	await chrome.storage.local.set({ [BFF_ORIGIN_STORAGE_KEY]: origin });
	return origin;
}

export async function bffFetch(
	path: string,
	init: RequestInit = {},
	origin?: string,
): Promise<Response> {
	return fetch(bffUrl(path, origin ?? (await getBffOrigin())), {
		...init,
		credentials: "include",
	});
}
