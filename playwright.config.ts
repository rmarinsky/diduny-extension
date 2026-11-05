import { defineConfig } from "@playwright/test";

export default defineConfig({
	fullyParallel: false,
	projects: [
		// The suite CI runs: every scripted test case.
		{ name: "e2e", testIgnore: ["**/charters/**", "**/os-input/**"] },
		// Seeded walks and boundary matrices from the exploratory charters.
		{ name: "charters", testMatch: "charters/**/*.spec.ts", timeout: 300_000 },
		// Real key presses and Chrome's real prompts in a visible window (Windows only).
		{ name: "os-input", testMatch: "os-input/**/*.spec.ts", timeout: 180_000 },
	],
	reporter: process.env.CI ? "github" : "list",
	testDir: "./e2e",
	timeout: 60_000,
	use: { trace: "retain-on-failure" },
	workers: 1,
});
