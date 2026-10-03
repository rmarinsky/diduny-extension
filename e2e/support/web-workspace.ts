import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import {
	type Browser,
	type BrowserContext,
	type Page,
	test as base,
	expect,
} from "@playwright/test";
import type Fastify from "fastify";
import { chromium } from "playwright";
import { buildServer } from "../../server";
import { type MockProxy, buildMockProxy } from "../../src/mock-proxy";
import {
	installFakeDictationCapture,
	installSupportedBrowserCapabilities,
} from "./browser-capabilities";
import {
	type WorkspaceLibrary,
	type WorkspaceLibraryOptions,
	createWorkspaceLibrary,
} from "./workspace-library";

export { expect };

export const TEST_EMAIL = "qa.web@example.com";

export interface MicrophoneDevice {
	deviceId: string;
	label: string;
}

export interface MicrophoneDoubleOptions {
	devices?: readonly MicrophoneDevice[];
	permission?: "denied" | "granted" | "prompt";
}

export interface WorkspaceOptions extends WorkspaceLibraryOptions {
	/**
	 * "fake" replaces AudioContext, AudioWorkletNode and MediaRecorder with test
	 * doubles; "real" records Chromium's fake microphone, so the saved WebM can
	 * be played back.
	 */
	capture?: "fake" | "real";
	/** A visible window, which real OS input and Chrome's prompts need. */
	headed?: boolean;
	/**
	 * With real capture: show Chrome's real microphone prompt instead of
	 * accepting it. Uses a regular (persistent) profile, where Chrome asks.
	 */
	microphonePrompt?: boolean;
	microphones?: MicrophoneDoubleOptions;
	onboardingCompleted?: boolean;
	signIn?: boolean;
	viewport?: { height: number; width: number };
}

export interface UpstreamReply {
	body?: unknown;
	status?: number;
}

export interface Workspace {
	bffUrl: string;
	browser: Browser;
	context: BrowserContext;
	library: WorkspaceLibrary;
	mock: MockProxy;
	/** Opens another tab of the workspace in the same browser profile. */
	newPage(): Promise<Page>;
	/** Answers `METHOD /api/v1/...` on the upstream with a fixed reply; null removes it. */
	override(route: string, reply: UpstreamReply | null): void;
	page: Page;
}

function serverUrl(server: ReturnType<typeof Fastify>) {
	const address = server.server.address();
	if (!address || typeof address === "string")
		throw new Error("Server did not bind a port");
	return `http://localhost:${address.port}`;
}

function isSettingsLoad(response: {
	request(): { method(): string };
	url(): string;
}) {
	return (
		response.request().method() === "GET" &&
		new URL(response.url()).pathname === "/bff/settings"
	);
}

export async function signIn(page: Page, email = TEST_EMAIL) {
	await page.getByLabel("Email").fill(email);
	await page.getByRole("button", { name: "Send one-time code" }).click();
	await page.getByLabel("One-time code").fill("123456");
	const settingsLoaded = page.waitForResponse(isSettingsLoad);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await settingsLoaded;
}

/** Loads the workspace and waits until the saved settings have arrived. */
export async function openWorkspace(page: Page, url: string) {
	const settingsLoaded = page.waitForResponse(isSettingsLoad);
	await page.goto(url);
	await settingsLoaded;
}

export async function reloadWorkspace(page: Page) {
	const settingsLoaded = page.waitForResponse(isSettingsLoad);
	await page.reload();
	await settingsLoaded;
}

export function dictationDocument(page: Page) {
	return page.getByLabel("Dictation document");
}

export function dictationStatus(page: Page) {
	return page.locator(".meter-row .status");
}

/** Start, record for about a second, Stop. Does not wait for the transcript. */
export async function dictate(page: Page) {
	await page.getByRole("button", { name: "Start dictation" }).click();
	await expect(page.locator(".meter-row output")).toHaveText("1s");
	await page.getByRole("button", { name: "Stop dictation" }).click();
}

/** The JSON config frames the page sent to the upstream realtime socket. */
export function realtimeConfigs(mock: MockProxy) {
	return mock
		.realtimeFrames()
		.filter((frame) => !frame.isBinary)
		.map((frame) => {
			try {
				return JSON.parse(String(frame.data)) as Record<string, unknown>;
			} catch {
				return null;
			}
		})
		.filter(
			(frame): frame is Record<string, unknown> =>
				frame !== null && "audio_format" in frame,
		);
}

/** Makes the page fall back from realtime to the HTTP transcription upload. */
export function disableRealtime(mock: MockProxy) {
	mock.setBehavior("/api/v1/realtime", "server_error");
}

/**
 * Holds the page's HTTP transcription uploads until the returned function is
 * called, so a test can act while the page says "Transcribing…".
 */
export async function holdTranscriptions(page: Page) {
	let release: () => void = () => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/bff/api/transcriptions", async (route) => {
		await released;
		await route.continue();
	});
	return release;
}

export function clipboardText(page: Page) {
	// Windows stores clipboard text with CRLF line endings.
	return page
		.evaluate(() => navigator.clipboard.readText())
		.then((text) => text.replace(/\r\n/g, "\n"));
}

/**
 * Microphone permission and devices the page sees. getUserMedia records its
 * constraints in `window.didunyMicrophone.calls`; set
 * `window.didunyMicrophone.failWith` to a DOMException name to make it fail.
 */
export async function installMicrophoneDouble(
	context: BrowserContext,
	options: MicrophoneDoubleOptions,
) {
	await context.addInitScript(
		({ devices, permission }) => {
			const state = {
				calls: [] as unknown[],
				devices: [...devices],
				failWith: null as string | null,
				permission,
			};
			Object.defineProperty(globalThis, "didunyMicrophone", {
				configurable: true,
				value: state,
			});
			Object.defineProperty(navigator, "permissions", {
				configurable: true,
				value: { query: async () => ({ state: state.permission }) },
			});
			Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
				configurable: true,
				value: async () =>
					state.permission === "granted"
						? state.devices.map((device) => ({
								...device,
								groupId: "",
								kind: "audioinput",
							}))
						: [],
			});
			const original = navigator.mediaDevices.getUserMedia.bind(
				navigator.mediaDevices,
			);
			Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
				configurable: true,
				value: async (constraints: MediaStreamConstraints) => {
					state.calls.push(JSON.parse(JSON.stringify(constraints)));
					if (state.failWith)
						throw new DOMException("Test microphone failure", state.failWith);
					if (state.permission === "denied")
						throw new DOMException("Permission denied", "NotAllowedError");
					const audio = constraints.audio;
					const wanted =
						audio && typeof audio === "object" && audio.deviceId
							? (audio.deviceId as { exact?: string }).exact
							: undefined;
					const device = wanted
						? state.devices.find((input) => input.deviceId === wanted)
						: state.devices[0];
					if (wanted && !device)
						throw new DOMException("Device not found", "OverconstrainedError");
					state.permission = "granted";
					const stream = await original(constraints);
					// A stream from the capture double has no tracks; name the device it "opened".
					const track = {
						kind: "audio",
						label: device?.label ?? "",
						stop() {},
					};
					Object.defineProperty(stream, "getAudioTracks", {
						value: () => [track],
					});
					Object.defineProperty(stream, "getTracks", { value: () => [track] });
					return stream;
				},
			});
		},
		{
			devices: options.devices ?? [
				{ deviceId: "built-in", label: "Built-in Microphone" },
				{ deviceId: "usb", label: "USB Microphone" },
			],
			permission: options.permission ?? "granted",
		},
	);
}

/** Reads a zip written by src/server/zip.ts (stored or deflated entries). */
export function readZip(archive: Buffer) {
	const entries = new Map<string, Buffer>();
	let end = archive.length - 22;
	while (end >= 0 && archive.readUInt32LE(end) !== 0x06054b50) end -= 1;
	if (end < 0) throw new Error("Not a zip archive");
	const count = archive.readUInt16LE(end + 10);
	let offset = archive.readUInt32LE(end + 16);
	for (let index = 0; index < count; index += 1) {
		const method = archive.readUInt16LE(offset + 10);
		const compressedSize = archive.readUInt32LE(offset + 20);
		const nameLength = archive.readUInt16LE(offset + 28);
		const extraLength = archive.readUInt16LE(offset + 30);
		const commentLength = archive.readUInt16LE(offset + 32);
		const localOffset = archive.readUInt32LE(offset + 42);
		const name = archive.toString(
			"utf8",
			offset + 46,
			offset + 46 + nameLength,
		);
		const localNameLength = archive.readUInt16LE(localOffset + 26);
		const localExtraLength = archive.readUInt16LE(localOffset + 28);
		const dataStart = localOffset + 30 + localNameLength + localExtraLength;
		const data = archive.subarray(dataStart, dataStart + compressedSize);
		entries.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

async function startWorkspace(
	options: WorkspaceOptions,
): Promise<Workspace & { close(): Promise<void> }> {
	const mock = await buildMockProxy({
		numberTranscripts: true,
		tagTranslations: true,
	});
	const overrides = new Map<string, UpstreamReply>();
	mock.server.addHook("onRequest", (request, reply, done) => {
		const path = new URL(request.raw.url ?? "", "http://mock.local").pathname;
		const override = overrides.get(`${request.method} ${path}`);
		if (!override) return done();
		reply.code(override.status ?? 200).send(override.body ?? {});
	});
	await mock.server.listen({ host: "localhost", port: 0 });
	const library = createWorkspaceLibrary(options);
	const bff = await buildServer({
		library: library.library,
		staticDir: fileURLToPath(new URL("../../web/dist", import.meta.url)),
		upstreamUrl: serverUrl(mock.server),
	});
	await bff.listen({ host: "localhost", port: 0 });
	const bffUrl = serverUrl(bff);
	const realCapture = options.capture === "real";
	const launch = {
		args: realCapture
			? [
					"--use-fake-device-for-media-stream",
					...(options.microphonePrompt
						? []
						: ["--use-fake-ui-for-media-stream"]),
					"--autoplay-policy=no-user-gesture-required",
				]
			: [],
		channel: "chromium",
		headless: !options.headed,
	};
	// Playwright's throwaway contexts deny the microphone outright, so Chrome
	// only asks in a regular profile.
	const userDataDir = options.microphonePrompt
		? await mkdtemp(join(tmpdir(), "diduny-web-e2e-"))
		: undefined;
	const persistent = userDataDir
		? await chromium.launchPersistentContext(userDataDir, {
				...launch,
				...(options.viewport ? { viewport: options.viewport } : {}),
			})
		: undefined;
	const browser = persistent?.browser() ?? (await chromium.launch(launch));
	const context =
		persistent ??
		(await browser.newContext(
			options.viewport ? { viewport: options.viewport } : {},
		));
	// Granting some permissions denies the rest, the microphone included, so
	// Chrome would never ask; prompt tests leave the clipboard alone.
	if (!options.microphonePrompt)
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: bffUrl,
		});
	await installSupportedBrowserCapabilities(context, {
		onboardingCompleted: options.onboardingCompleted ?? true,
	});
	if (!realCapture) await installFakeDictationCapture(context);
	if (options.microphones)
		await installMicrophoneDouble(context, options.microphones);
	const page = await context.newPage();
	await page.goto(`${bffUrl}/`);
	if (options.signIn ?? true) await signIn(page);

	return {
		bffUrl,
		browser,
		async close() {
			bff.server.closeAllConnections?.();
			mock.server.server.closeAllConnections?.();
			await (persistent ? persistent.close() : browser.close());
			await bff.close();
			await mock.server.close();
			library.close();
			if (userDataDir) await rm(userDataDir, { force: true, recursive: true });
		},
		context,
		library,
		mock,
		async newPage() {
			const next = await context.newPage();
			await openWorkspace(next, `${bffUrl}/`);
			return next;
		},
		override(route, reply) {
			if (reply) overrides.set(route, reply);
			else overrides.delete(route);
		},
		page,
	};
}

export const test = base.extend<{
	workspace: (options?: WorkspaceOptions) => Promise<Workspace>;
}>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures must destructure their dependencies.
	workspace: async ({}, use) => {
		const started: Array<() => Promise<void>> = [];
		await use(async (options = {}) => {
			const workspace = await startWorkspace(options);
			started.push(workspace.close);
			return workspace;
		});
		for (const close of started.reverse()) await close();
	},
});
