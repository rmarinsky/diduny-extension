import { expect, test } from "bun:test";
import { findBuildSecurityViolations } from "../scripts/check-build-security";

test("rejects inline scripts and eval in production assets", () => {
	expect(
		findBuildSecurityViolations([
			{
				path: "web/dist/index.html",
				source: '<script src="/assets/app.js"></script>',
			},
			{ path: "web/dist/assets/app.js", source: "export const ready = true;" },
		]),
	).toEqual([]);

	expect(
		findBuildSecurityViolations([
			{ path: "web/dist/index.html", source: "<script>run()</script>" },
			{ path: "web/dist/assets/app.js", source: "eval('run()')" },
		]),
	).toEqual([
		"web/dist/index.html: inline script",
		"web/dist/assets/app.js: eval",
	]);
});
