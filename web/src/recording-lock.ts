interface WebLockManager {
	request(
		name: string,
		options: { ifAvailable: true; mode: "exclusive" },
		callback: (lock: object | null) => Promise<void>,
	): Promise<void>;
}

export async function acquireRecordingLock(
	locks: WebLockManager | undefined = navigator.locks,
): Promise<(() => void) | null> {
	if (!locks) return null;
	let resolveAcquired: (release: (() => void) | null) => void;
	const acquired = new Promise<(() => void) | null>((resolve) => {
		resolveAcquired = resolve;
	});
	void locks
		.request(
			"diduny-recording",
			{ ifAvailable: true, mode: "exclusive" },
			async (lock) => {
				if (!lock) {
					resolveAcquired(null);
					return;
				}
				let release: () => void;
				const released = new Promise<void>((resolve) => {
					release = resolve;
				});
				resolveAcquired(() => release());
				await released;
			},
		)
		.catch(() => resolveAcquired(null));
	return acquired;
}
