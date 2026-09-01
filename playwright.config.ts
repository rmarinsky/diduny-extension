import { defineConfig } from "@playwright/test";

export default defineConfig({
	fullyParallel: false,
	reporter: process.env.CI ? "github" : "list",
	testDir: "./e2e",
	timeout: 60_000,
	use: { trace: "retain-on-failure" },
	workers: 1,
});
