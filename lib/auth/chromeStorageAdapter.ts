import type { SupportedStorage } from "@supabase/supabase-js";

/**
 * Custom storage adapter for @supabase/supabase-js in Chrome MV3 service workers.
 *
 * Supabase SDK requires a synchronous-looking Storage interface but also accepts
 * a Promise-returning variant via SupportedStorage. Chrome's storage.local is
 * async, which matches perfectly.
 *
 * Per ADR-0005: session state persists in chrome.storage.local so it survives
 * SW suspension cycles. No in-memory auth state needed between wake events.
 *
 * The key written by the SDK is: sb-<project-ref>-auth-token
 * Treat the key format as an SDK implementation detail — never read/write it directly.
 */
export const chromeStorageAdapter: SupportedStorage = {
	getItem: (key: string): Promise<string | null> =>
		chrome.storage.local
			.get(key)
			.then((r) => (r[key] as string | null) ?? null),

	setItem: (key: string, value: string): Promise<void> =>
		chrome.storage.local.set({ [key]: value }),

	removeItem: (key: string): Promise<void> => chrome.storage.local.remove(key),
};
