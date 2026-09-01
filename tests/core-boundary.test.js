import { expect, test } from "bun:test";
import { findCoreBoundaryViolations } from "../scripts/check-core-boundary";

test("rejects browser globals and node imports from core", () => {
	expect(
		findCoreBoundaryViolations([
			{ path: "src/core/ok.ts", source: "export const value = 1;" },
			{
				path: "src/core/bad.ts",
				source: 'import("node:path"); document.title = "bad";',
			},
		]),
	).toEqual([
		"src/core/bad.ts: node: import",
		"src/core/bad.ts: document global",
	]);
});
