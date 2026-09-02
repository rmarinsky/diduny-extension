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

export type CaptureTerminalDecision = {
	accepted: boolean;
	captureId: string;
	pendingDelivery?: { source: AudioSource; text: string };
	shouldClose: boolean;
};

type CaptureTerminalState = {
	captureId: string;
	completedSources: AudioSource[];
	deliveredSources: AudioSource[];
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

function isTerminalState(value: unknown): value is CaptureTerminalState {
	if (!value || typeof value !== "object") return false;
	const state = value as Partial<CaptureTerminalState>;
	return (
		typeof state.captureId === "string" &&
		state.captureId.length > 0 &&
		typeof state.terminal === "boolean" &&
		sourceList(state.completedSources) !== undefined &&
		sourceList(state.deliveredSources) !== undefined &&
		sourceList(state.persistedSources) !== undefined &&
		(state.pendingDelivery === undefined ||
			(isAudioSource(state.pendingDelivery.source) &&
				typeof state.pendingDelivery.text === "string"))
	);
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

export function createCaptureTerminalLifecycle(
	storage: CaptureLifecycleStorage,
) {
	let activeCaptureId: string | undefined;
	let serial = Promise.resolve();

	function ignored(captureId: string): CaptureTerminalDecision {
		return { accepted: false, captureId, shouldClose: false };
	}

	function decision(
		captureId: string,
		shouldClose = false,
	): CaptureTerminalDecision {
		return { accepted: true, captureId, shouldClose };
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
		return isTerminalState(value) ? value : undefined;
	}

	async function transition(
		expectedCaptureId: string | undefined,
		apply: (state: CaptureTerminalState) => CaptureTerminalDecision,
	): Promise<CaptureTerminalDecision> {
		return serialize(async () => {
			const stored = await storedState();
			const captureId =
				expectedCaptureId ?? activeCaptureId ?? stored?.captureId ?? "legacy";
			if (activeCaptureId === undefined) {
				activeCaptureId = captureId;
			}
			if (activeCaptureId !== captureId) return ignored(captureId);
			if (stored && stored.captureId !== captureId) return ignored(captureId);

			const state = stored ?? emptyState(captureId);
			const result = apply(state);
			if (result.accepted) {
				await storage.set({ [CAPTURE_TERMINAL_STORAGE_KEY]: state });
			}
			return result;
		});
	}

	function finishIfReady(state: CaptureTerminalState): CaptureTerminalDecision {
		if (!state.terminal && isReadyToFinish(state)) {
			state.terminal = true;
			return decision(state.captureId, true);
		}
		return decision(state.captureId);
	}

	return {
		begin(): CaptureRun {
			const captureId = crypto.randomUUID();
			return {
				id: captureId,
				ready: serialize(async () => {
					activeCaptureId = captureId;
					await storage.set({
						[CAPTURE_TERMINAL_STORAGE_KEY]: emptyState(captureId),
					});
				}),
			};
		},
		captureComplete(source: AudioSource, text: string) {
			const captureId = activeCaptureId;
			return transition(captureId, (state) => {
				if (state.terminal || state.completedSources.includes(source))
					return ignored(state.captureId);
				state.completedSources = addSource(state.completedSources, source);
				state.pendingDelivery = { source, text };
				return decision(state.captureId);
			});
		},
		capturePersisted(source: AudioSource) {
			const captureId = activeCaptureId;
			return transition(captureId, (state) => {
				if (state.terminal || state.persistedSources.includes(source))
					return ignored(state.captureId);
				state.persistedSources = addSource(state.persistedSources, source);
				return finishIfReady(state);
			});
		},
		deliveryFinished(captureId: string, source: AudioSource) {
			return transition(captureId, (state) => {
				if (
					state.terminal ||
					!state.completedSources.includes(source) ||
					state.deliveredSources.includes(source)
				)
					return ignored(state.captureId);
				state.deliveredSources = addSource(state.deliveredSources, source);
				if (state.pendingDelivery?.source === source)
					state.pendingDelivery = undefined;
				return finishIfReady(state);
			});
		},
		resume() {
			return serialize(async () => {
				const state = await storedState();
				if (!state) return undefined;
				activeCaptureId = state.captureId;
				return {
					...decision(state.captureId, state.terminal),
					...(state.pendingDelivery
						? { pendingDelivery: state.pendingDelivery }
						: {}),
				};
			});
		},
		isCurrent(candidate: string) {
			return candidate === activeCaptureId;
		},
	};
}
