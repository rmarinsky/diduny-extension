import { refreshToken as apiRefresh } from "../api/auth";
import type { AuthTokens } from "../types";

const STORAGE_KEY = "diduny_auth";
const ALARM_NAME = "diduny_token_refresh";
const REFRESH_INTERVAL_MINUTES = 14;

export async function getTokens(): Promise<AuthTokens | null> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	return result[STORAGE_KEY] ?? null;
}

export async function saveTokens(tokens: AuthTokens): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEY]: tokens });
	// Schedule recurring refresh every 14 min (tokens expire in 15 min)
	await chrome.alarms.create(ALARM_NAME, {
		delayInMinutes: REFRESH_INTERVAL_MINUTES,
		periodInMinutes: REFRESH_INTERVAL_MINUTES,
	});
}

export async function clearTokens(): Promise<void> {
	await chrome.storage.local.remove(STORAGE_KEY);
	await chrome.alarms.clear(ALARM_NAME);
}

export async function refreshTokens(): Promise<AuthTokens | null> {
	const current = await getTokens();
	if (!current?.refreshToken) return null;

	try {
		const { accessToken, refreshToken } = await apiRefresh(
			current.refreshToken,
		);
		const updated: AuthTokens = {
			accessToken,
			refreshToken,
			user: current.user,
		};
		await saveTokens(updated);
		return updated;
	} catch {
		await clearTokens();
		return null;
	}
}

/** Try to refresh on startup if tokens exist (covers SW restart / browser reopen). */
export async function refreshOnStartup(): Promise<void> {
	const tokens = await getTokens();
	if (tokens?.refreshToken) {
		await refreshTokens();
	}
}

export function setupAlarmListener(): void {
	chrome.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === ALARM_NAME) {
			refreshTokens();
		}
	});
}
