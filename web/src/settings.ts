import type { RetentionCategory, RetentionPolicy } from "../../src/core/ports";
import type { Settings } from "../../src/core/settings";
import { errorFromResponse, localProcessUnavailable } from "./errors";

export interface WorkspaceSettingsSnapshot {
	retention: Record<RetentionCategory, RetentionPolicy>;
	settings: Settings;
	stats: {
		dictationDurationSeconds: number;
		recordingCount: number;
		timeSavedSeconds: number | null;
		wordCount: number;
	};
	storage: {
		dataDir: string;
		freeBytes: number;
		usedBytes: number;
	};
}

async function errorFor(response: Response) {
	return errorFromResponse(
		response.status,
		await response.json().catch(() => null),
	);
}

async function request(path: string, init?: RequestInit) {
	try {
		return await fetch(path, { credentials: "same-origin", ...init });
	} catch (error) {
		throw localProcessUnavailable(error);
	}
}

export async function getWorkspaceSettings(): Promise<WorkspaceSettingsSnapshot> {
	const response = await request("/bff/settings");
	if (!response.ok) throw await errorFor(response);
	return response.json() as Promise<WorkspaceSettingsSnapshot>;
}

export async function updateWorkspaceSettings(
	changes: Partial<Settings>,
): Promise<Settings> {
	const response = await request("/bff/settings", {
		body: JSON.stringify(changes),
		headers: { "content-type": "application/json" },
		method: "PATCH",
	});
	if (!response.ok) throw await errorFor(response);
	return response.json() as Promise<Settings>;
}

export async function updateRetentionPolicy(
	category: RetentionCategory,
	policy: RetentionPolicy,
): Promise<Record<RetentionCategory, RetentionPolicy>> {
	const response = await request("/bff/settings/retention", {
		body: JSON.stringify({ category, policy }),
		headers: { "content-type": "application/json" },
		method: "PUT",
	});
	if (!response.ok) throw await errorFor(response);
	return response.json() as Promise<Record<RetentionCategory, RetentionPolicy>>;
}
