export interface DeliverySession {
	tabId: number;
	frameId: number;
}

export function selectDeliverySession(
	tabId: number,
	results: readonly { frameId: number; result?: { ready?: boolean } }[],
): DeliverySession | undefined {
	const target = results.find((result) => result.result?.ready === true);
	return target ? { tabId, frameId: target.frameId } : undefined;
}

export function isDeliverySession(value: unknown): value is DeliverySession {
	if (!value || typeof value !== "object") return false;
	const session = value as Partial<DeliverySession>;
	return (
		typeof session.tabId === "number" &&
		typeof session.frameId === "number" &&
		Number.isInteger(session.tabId) &&
		Number.isInteger(session.frameId) &&
		session.tabId >= 0 &&
		session.frameId >= 0
	);
}
