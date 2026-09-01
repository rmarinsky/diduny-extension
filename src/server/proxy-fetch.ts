import { HTTP } from "../core/constants";

export function proxyFetch(
	fetch: typeof globalThis.fetch,
	url: string,
	init: RequestInit = {},
	timeoutMs: number = HTTP.logoutTimeoutMs,
) {
	const timeout = AbortSignal.timeout(timeoutMs);
	return fetch(url, {
		...init,
		signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
	});
}
