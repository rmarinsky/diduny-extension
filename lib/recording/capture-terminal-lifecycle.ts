import type { AudioSource } from "../messaging/types";

export const CAPTURE_TERMINAL_STORAGE_KEY = "didunyCaptureTerminalState";

export type CaptureLifecycleStorage = {
	get(key: string): Promise<Record<string, unknown>>;
	set(values: Record<string, unknown>): Promise<void>;
};

export type CaptureRun = {
	id: string;
	ready: Promise<void>;
};

export type CaptureTerminalOutcome =
	| { kind: "success" }
	| { error: string; kind: "error" };

export type CaptureTerminalDecision = {
	accepted: boolean;
	captureId: string;
	outcome?: CaptureTerminalOutcome;
	pendingDelivery?: { source: AudioSource; text: string };
	shouldClose: boolean;
};

type CaptureTerminalState = {
	captureId: string;
	completedSources: AudioSource[];
	deliveredSources: AudioSource[];
	cleanupComplete?: boolean;
	outcome?: CaptureTerminalOutcome;
	pendingDelivery?: { source: AudioSource; text: string };
	persistedSources: AudioSource[];
	terminal: boolean;
};

function isAudioSource(value: unknown): value is AudioSource {
	return value === "mic" || value === "tab";
}

function sourceList(value: unknown): AudioSource[] | undefined {
	if (!Array.isArray(value) || !value.every(isAudioSource)) return undefined;
	return [...new Set(value)];
}

function isOutcome(value: unknown): value is CaptureTerminalOutcome {
	if (!value || typeof value !== "object") return false;
	const outcome = value as Partial<CaptureTerminalOutcome>;
	return (
		outcome.kind === "success" ||
		(outcome.kind === "error" && typeof outcome.error === "string")
	);
}

function isTerminalState(value: unknown): value is CaptureTerminalState {
	if (!value || typeof value !== "object") return false;
	const state = value as Partial<CaptureTerminalState>;
	return (
		typeof state.captureId === "string" &&
		state.captureId.length > 0 &&
		typeof state.terminal === "boolean" &&
		(state.cleanupComplete === undefined ||
			typeof state.cleanupComplete === "boolean") &&
		(state.outcome === undefined || isOutcome(state.outcome)) &&
		sourceList(state.completedSources) !== undefined &&
		sourceList(state.deliveredSources) !== undefined &&
		sourceList(state.persistedSources) !== undefined &&
		(state.pendingDelivery === undefined ||
			(isAudioSource(state.pendingDelivery.source) &&
				typeof state.pendingDelivery.text === "string"))
	);
}

function normalizedState(value: unknown): CaptureTerminalState | undefined {
	if (!isTerminalState(value)) return undefined;
	const outcome: CaptureTerminalOutcome | undefined =
		value.outcome ?? (value.terminal ? { kind: "success" } : undefined);
	return {
		captureId: value.captureId,
		completedSources: sourceList(value.completedSources) ?? [],
		deliveredSources: sourceList(value.deliveredSources) ?? [],
		...(value.cleanupComplete ? { cleanupComplete: true } : {}),
		...(outcome ? { outcome } : {}),
		...(value.pendingDelivery
			? { pendingDelivery: value.pendingDelivery }
			: {}),
		persistedSources: sourceList(value.persistedSources) ?? [],
		terminal: Boolean(outcome),
	};
}

function emptyState(captureId: string): CaptureTerminalState {
	return {
		captureId,
		completedSources: [],
		deliveredSources: [],
		persistedSources: [],
		terminal: false,
	};
}

function addSource(sources: AudioSource[], source: AudioSource) {
	return sources.includes(source) ? sources : [...sources, source];
}

function isReadyToFinish(state: CaptureTerminalState) {
	// ponytail: current captures have one source; pass expected sources to begin() before adding dual-pipeline capture.
	const sources = [
		...new Set([
			...state.completedSources,
			...state.deliveredSources,
			...state.persistedSources,
		]),
	];
	return (
		sources.length > 0 &&
		sources.every(
			(source) =>
				state.completedSources.includes(source) &&
				state.deliveredSources.includes(source) &&
				state.persistedSources.includes(source),
		)
	);
}

function decision(state: CaptureTerminalState): CaptureTerminalDecision {
	return {
		accepted: true,
		captureId: state.captureId,
		...(state.outcome ? { outcome: state.outcome } : {}),
		...(state.pendingDelivery
			? { pendingDelivery: state.pendingDelivery }
			: {}),
		shouldClose: Boolean(state.outcome) && !state.pendingDelivery,
	};
}

export function createCaptureTerminalLifecycle(
	storage: CaptureLifecycleStorage,
) {
	let activeCaptureId: string | undefined;
	let serial = Promise.resolve();

	function ignored(captureId: string): CaptureTerminalDecision {
		return { accepted: false, captureId, shouldClose: false };
	}

	function serialize<T>(operation: () => Promise<T>) {
		const next = serial.then(operation, operation);
		serial = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	async function storedState() {
		const stored = await storage.get(CAPTURE_TERMINAL_STORAGE_KEY);
		const value = stored[CAPTURE_TERMINAL_STORAGE_KEY];
		return normalizedState(value);
	}

	async function transition(
		captureId: string,
		apply: (state: CaptureTerminalState) => CaptureTerminalDecision,
	): Promise<CaptureTerminalDecision> {
		return serialize(async () => {
			const stored = await storedState();
			if (!stored || stored.captureId !== captureId) return ignored(captureId);
			if (activeCaptureId === undefined) activeCaptureId = stored.captureId;
			if (activeCaptureId !== captureId) return ignored(captureId);

			const state = stored;
			const result = apply(state);
			if (result.accepted) {
				await storage.set({ [CAPTURE_TERMINAL_STORAGE_KEY]: state });
			}
			return result;
		});
	}

	function finishIfReady(state: CaptureTerminalState): CaptureTerminalDecision {
		if (!state.outcome && isReadyToFinish(state)) {
			state.terminal = true;
			state.outcome = { kind: "success" };
		}
		return decision(state);
	}

	return {
		begin(closeStaleTerminal?: () => void | Promise<void>): CaptureRun {
			const captureId = crypto.randomUUID();
			return {
				id: captureId,
				ready: serialize(async () => {
					const stored = await storedState();
					if (stored?.outcome && !stored.cleanupComplete)
						await closeStaleTerminal?.();
					activeCaptureId = captureId;
					await storage.set({
						[CAPTURE_TERMINAL_STORAGE_KEY]: emptyState(captureId),
					});
				}),
			};
		},
		captureComplete(captureId: string, source: AudioSource, text: string) {
			return transition(captureId, (state) => {
				if (state.outcome || state.completedSources.includes(source))
					return ignored(state.captureId);
				state.completedSources = addSource(state.completedSources, source);
				state.pendingDelivery = { source, text };
				return decision(state);
			});
		},
		capturePersisted(captureId: string, source: AudioSource) {
			return transition(captureId, (state) => {
				if (state.outcome || state.persistedSources.includes(source))
					return ignored(state.captureId);
				state.persistedSources = addSource(state.persistedSources, source);
				return finishIfReady(state);
			});
		},
		captureFailed(captureId: string, error: string) {
			return transition(captureId, (state) => {
				if (state.outcome) return ignored(state.captureId);
				state.outcome = { error, kind: "error" };
				state.terminal = true;
				return decision(state);
			});
		},
		deliveryFinished(captureId: string, source: AudioSource) {
			return transition(captureId, (state) => {
				if (
					!state.completedSources.includes(source) ||
					state.deliveredSources.includes(source)
				)
					return ignored(state.captureId);
				state.deliveredSources = addSource(state.deliveredSources, source);
				if (state.pendingDelivery?.source === source)
					state.pendingDelivery = undefined;
				if (state.outcome) return decision(state);
				return finishIfReady(state);
			});
		},
		resume() {
			return serialize(async () => {
				const state = await storedState();
				if (!state) return undefined;
				activeCaptureId = state.captureId;
				return decision(state);
			});
		},
		cleanup(captureId: string, closeCallback: () => void | Promise<void>) {
			return serialize(async () => {
				const state = await storedState();
				if (
					activeCaptureId !== captureId ||
					!state ||
					state.captureId !== captureId ||
					!state.outcome ||
					state.pendingDelivery ||
					state.cleanupComplete
				)
					return ignored(captureId);
				await closeCallback();
				state.cleanupComplete = true;
				await storage.set({ [CAPTURE_TERMINAL_STORAGE_KEY]: state });
				return decision(state);
			});
		},
		isCurrent(candidate: string) {
			return candidate === activeCaptureId;
		},
	};
}
