import { INPUT_TIMING } from "../../src/core/constants";

export interface CommandPress {
	at: number;
	count: number;
}

export function nextCommandPress(
	previous: CommandPress | undefined,
	at: number,
): CommandPress {
	return previous && at - previous.at <= INPUT_TIMING.multiPressWindowMs
		? { at, count: previous.count + 1 }
		: { at, count: 1 };
}
