const STORAGE_KEY = "diduny_crash_log";
const MAX_ENTRIES = 100;

export interface LogEntry {
	ts: string;
	ctx: string;
	level: "error" | "warn" | "info";
	msg: string;
	stack?: string;
}

const consoleMethods = {
	info: console.info,
	warn: console.warn,
	error: console.error,
} as const;

export async function crashLog(
	ctx: string,
	level: LogEntry["level"],
	msg: string,
	stack?: string,
): Promise<void> {
	const tag = `[diduny:${ctx}]`;
	consoleMethods[level](tag, msg, stack ?? "");

	try {
		const entry: LogEntry = {
			ts: new Date().toISOString(),
			ctx,
			level,
			msg,
			stack,
		};
		const result = await chrome.storage.local.get(STORAGE_KEY);
		const logs: LogEntry[] = result[STORAGE_KEY] ?? [];
		logs.push(entry);
		if (logs.length > MAX_ENTRIES) {
			logs.splice(0, logs.length - MAX_ENTRIES);
		}
		await chrome.storage.local.set({ [STORAGE_KEY]: logs });
	} catch {
		// Storage itself failed — nothing we can do
	}
}

export async function getCrashLogs(): Promise<LogEntry[]> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	return result[STORAGE_KEY] ?? [];
}

export async function clearCrashLogs(): Promise<void> {
	await chrome.storage.local.remove(STORAGE_KEY);
}

/** Capture a thrown value as a crash log entry. */
export function logError(ctx: string, err: unknown): void {
	const msg = err instanceof Error ? err.message : String(err);
	const stack = err instanceof Error ? err.stack : undefined;
	crashLog(ctx, "error", msg, stack);
}
