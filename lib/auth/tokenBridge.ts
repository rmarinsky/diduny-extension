/**
 * Token bridge — abstracts access-token retrieval across execution contexts.
 *
 * Per ADR-0005:
 * - Background side: reads directly from the Supabase SDK (which reads chrome.storage.local).
 * - Offscreen / other side: sends a {type:'getAccessToken'} message to the SW and awaits
 *   the response, with a 3 000 ms timeout before aborting.
 *
 * Callers always use getAccessToken() without caring which context they are in.
 * The background.ts entry point imports the background variant; offscreen imports this file
 * and the exported function detects context by the presence of the supabase singleton.
 *
 * Usage in offscreen/non-SW context:
 *   import { getAccessTokenFromSW } from '../lib/auth/tokenBridge';
 *   const { token, expires_at } = await getAccessTokenFromSW();
 */

export interface TokenResponse {
	token: string;
	expires_at: number;
}

export interface TokenError {
	error: "NOT_AUTHENTICATED" | "STORAGE_READ_FAILED" | "SESSION_EXPIRED";
}

export type TokenResult = TokenResponse | TokenError;

export function isTokenResponse(r: TokenResult): r is TokenResponse {
	return "token" in r;
}

/**
 * Called from the offscreen document (or any non-SW context) to obtain a fresh
 * access token from the service worker.
 *
 * Per ADR-0005 §Token delivery contract:
 * - Sends {type:'getAccessToken'} to the SW.
 * - Times out after 3 000 ms and throws if the SW does not respond.
 */
export function getAccessTokenFromSW(timeoutMs = 3000): Promise<TokenResult> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			console.warn("[tokenBridge] getAccessToken timeout after 3000ms");
			reject(new Error("getAccessToken timeout after 3000ms"));
		}, timeoutMs);

		chrome.runtime.sendMessage({ type: "getAccessToken" }, (response) => {
			clearTimeout(timer);
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
				return;
			}
			resolve(response as TokenResult);
		});
	});
}
