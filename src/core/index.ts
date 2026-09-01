export type CoreState = "idle";

export function createCore(): { state: CoreState } {
	return { state: "idle" };
}
