import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";

const run = promisify(execFile);
const script = resolve("e2e/support/os-input/os-input.ps1");
const titles = new WeakMap<Page, string>();

/** Real input needs Windows, a visible window and nobody else typing. */
export const osInputAvailable = process.platform === "win32";

interface OsInputResult {
	buttons?: string[];
	missing?: string;
	ok: boolean;
}

async function osInput(page: Page, args: string[]): Promise<OsInputResult> {
	// The window title follows the active tab, so a title only this page has finds its window.
	let title = titles.get(page);
	if (!title) {
		title = `diduny-os-input-${Math.random().toString(36).slice(2, 10)}`;
		titles.set(page, title);
	}
	await page.bringToFront();
	await page.evaluate((value) => {
		document.title = value;
	}, title);
	try {
		const { stdout } = await run(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				script,
				"-Title",
				title,
				...args,
			],
			{ timeout: 60_000, windowsHide: true },
		);
		return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "{}");
	} catch (error) {
		const stdout = (error as { stdout?: string }).stdout?.trim();
		if (stdout) return JSON.parse(stdout.split(/\r?\n/).at(-1) ?? "{}");
		throw error;
	}
}

/** Brings the browser window showing `page` to the foreground. */
export async function focusWindow(page: Page) {
	await osInput(page, ["-Action", "focus"]);
}

/**
 * Presses a chord such as "Alt+Shift+V" as real key events, so Chrome's own
 * shortcuts see it; `times` presses it again after `gapMs` each time.
 * `focusButton` first moves focus to a button in Chrome's UI, such as a prompt's.
 */
export async function pressKeys(
	page: Page,
	keys: string,
	{
		focusButton,
		gapMs = 80,
		times = 1,
	}: { focusButton?: string; gapMs?: number; times?: number } = {},
) {
	const result = await osInput(page, [
		"-Action",
		"keys",
		"-Keys",
		keys,
		"-Times",
		String(times),
		"-GapMs",
		String(gapMs),
		...(focusButton ? ["-Name", focusButton] : []),
	]);
	if (!result.ok) throw new Error(`No "${focusButton}" button to focus`);
}

/** Names of the buttons in the browser's windows and popups (prompts, bubbles, toolbar). */
export async function browserButtons(page: Page) {
	return (await osInput(page, ["-Action", "buttons"])).buttons ?? [];
}

/**
 * Presses a button in Chrome's own UI, such as a permission prompt's "Allow
 * while visiting the site". `mouse` clicks it with the real mouse instead,
 * which the toolbar's extension button needs.
 */
export async function pressBrowserButton(
	page: Page,
	name: string,
	{
		mouse = false,
		timeoutMs = 10_000,
	}: { mouse?: boolean; timeoutMs?: number } = {},
) {
	const result = await osInput(page, [
		"-Action",
		mouse ? "click" : "press",
		"-Name",
		name,
		"-TimeoutMs",
		String(timeoutMs),
	]);
	if (!result.ok)
		throw new Error(
			`No "${name}" button in the browser; found: ${(result.buttons ?? []).join(" | ")}`,
		);
}
