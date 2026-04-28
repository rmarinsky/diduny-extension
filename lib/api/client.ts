import { clearTokens, getTokens, refreshTokens } from "../auth/token-manager";
import { PROXY_URL } from "../types";

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

export async function apiFetch(
	path: string,
	init?: RequestInit & { skipAuth?: boolean },
): Promise<Response> {
	const { skipAuth, ...fetchInit } = init ?? {};
	const headers = new Headers(fetchInit.headers);

	if (!skipAuth) {
		const tokens = await getTokens();
		if (tokens?.accessToken) {
			headers.set("Authorization", `Bearer ${tokens.accessToken}`);
		}
	}

	let res: Response;
	try {
		res = await fetch(`${PROXY_URL}${path}`, { ...fetchInit, headers });
	} catch (err) {
		throw new ApiError(0, err instanceof Error ? err.message : "Network error");
	}

	if (res.status === 401 && !skipAuth) {
		const refreshed = await refreshTokens();
		if (refreshed) {
			headers.set("Authorization", `Bearer ${refreshed.accessToken}`);
			const retry = await fetch(`${PROXY_URL}${path}`, {
				...fetchInit,
				headers,
			});
			if (!retry.ok) throw new ApiError(retry.status, await retry.text());
			return retry;
		}
		await clearTokens();
		throw new ApiError(401, "Session expired");
	}

	if (!res.ok) throw new ApiError(res.status, await res.text());
	return res;
}
