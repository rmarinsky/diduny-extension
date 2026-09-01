import type { RetentionCategory, RetentionPolicy } from "../../src/core/ports";
import type { Settings } from "../../src/core/settings";

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

function errorFor(response: Response, action: string) {
	return new Error(
		`${action} failed (${response.status}). Check the local Diduny service and try again.`,
	);
}

const request = (path: string, init?: RequestInit) =>
	fetch(path, { credentials: "same-origin", ...init });

export async function getWorkspaceSettings(): Promise<WorkspaceSettingsSnapshot> {
	const response = await request("/bff/settings");
	if (!response.ok) throw errorFor(response, "Loading settings");
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
	if (!response.ok) throw errorFor(response, "Saving settings");
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
	if (!response.ok) throw errorFor(response, "Saving retention");
	return response.json() as Promise<Record<RetentionCategory, RetentionPolicy>>;
}
