import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import Fastify from "fastify";
import { chromium } from "playwright";
import { buildServer } from "../server";
import { buildMockProxy } from "../src/mock-proxy";
import { installSupportedBrowserCapabilities } from "./support/browser-capabilities";
import { createE2eLibrary } from "./support/fake-library";

function serverUrl(server: ReturnType<typeof Fastify>, hostname = "127.0.0.1") {
	const address = server.server.address();
	if (!address || typeof address === "string")
		throw new Error("Server did not bind a port");
	return `http://${hostname}:${address.port}`;
}

test("loaded extension signs in through the mock proxy BFF, delivers dictation, and saves it", async () => {
	const accessToken = "access-token-should-never-reach-page";
	const refreshToken = "refresh-token-should-never-reach-page";
	const tokenFragments = [accessToken, refreshToken];
	const mock = await buildMockProxy({ accessToken, refreshToken });
	const fixtureServer = Fastify();
	const editorFixtures: Record<string, string> = {
		contenteditable:
			'<div id="contenteditable" contenteditable="true" role="textbox" aria-label="Contenteditable target">Contenteditable </div>',
		lexical:
			'<div data-lexical-editor="true"><div id="lexical" contenteditable="true" role="textbox" aria-label="Lexical target">Lexical</div></div>',
		linear:
			'<div id="linear" contenteditable="true" data-placeholder="Write a comment" role="textbox" aria-label="Linear target">Linear </div>',
		notion:
			'<div id="notion" contenteditable="true" data-content-editable-leaf="true" role="textbox" aria-label="Notion target">Notion </div>',
		prosemirror:
			'<div id="prosemirror" class="ProseMirror" contenteditable="true" role="textbox" aria-label="ProseMirror target">ProseMirror </div>',
		quill:
			'<div class="ql-container"><div id="quill" class="ql-editor" contenteditable="true" role="textbox" aria-label="Quill target">Quill </div></div>',
		slack:
			'<div data-qa="message_input"><div id="slack" contenteditable="true" role="textbox" aria-label="Slack target">Slack </div></div>',
	};
	fixtureServer.get("/fixture", async (_request, reply) =>
		reply.type("text/html").send(`
			<!doctype html>
			<title>Diduny delivery fixture</title>
			<textarea id="target" aria-label="Dictation target"></textarea>
			<textarea id="disabled-target" aria-label="Disabled delivery target"></textarea>
		`),
	);
	fixtureServer.get("/fixture/:editor", async (request, reply) => {
		const editor = (request.params as { editor?: string }).editor;
		if (editor === "google-docs") {
			return reply.type("text/html").send(`
				<!doctype html>
				<title>Google Docs delivery fixture</title>
				<div id="google-docs" class="kix-appview-editor" tabindex="0" role="textbox" aria-label="Google Docs canvas"></div>
			`);
		}
		const markup = editor ? editorFixtures[editor] : undefined;
		if (!markup) return reply.code(404).send();
		return reply.type("text/html").send(`
			<!doctype html>
			<title>${editor} delivery fixture</title>
			${markup}
			<output id="events"></output>
			<script>
				const target = document.querySelector('[contenteditable="true"]');
				for (const type of ['beforeinput', 'input']) target.addEventListener(type, event => {
					document.querySelector('#events').textContent += type + ':' + event.inputType + ':' + target.textContent + ';';
				});
				if (${JSON.stringify(editor)} === 'quill') {
					target.closest('.ql-container').__quill = {
						getSelection: () => ({ index: target.textContent.length }),
						insertText(index, text, source) {
							target.textContent = target.textContent.slice(0, index) + text + target.textContent.slice(index);
							document.querySelector('#events').textContent += 'quill:' + source + ':' + index + ';';
						},
					};
				}
				if (${JSON.stringify(editor)} === 'lexical') {
					target.addEventListener('beforeinput', event => {
						event.preventDefault();
						target.textContent += event.data;
						document.querySelector('#events').textContent += 'lexical:handled;';
					});
				}
			</script>
		`);
	});
	await mock.server.listen({ host: "localhost", port: 0 });
	await fixtureServer.listen({ host: "localhost", port: 0 });
	const upstreamUrl = serverUrl(mock.server, "localhost");
	const fixtureUrl = serverUrl(fixtureServer, "localhost");
	const e2eLibrary = createE2eLibrary();

	const bff = await buildServer({
		library: e2eLibrary.library,
		staticDir: resolve("web/dist"),
		upstreamUrl,
	});
	await bff.listen({ host: "localhost", port: 0 });
	const bffUrl = serverUrl(bff, "localhost");
	const userDataDir = await mkdtemp(join(tmpdir(), "diduny-extension-e2e-"));
	let context:
		| Awaited<ReturnType<typeof chromium.launchPersistentContext>>
		| undefined;

	try {
		const extensionPath = resolve(".output/chrome-mv3");
		context = await chromium.launchPersistentContext(userDataDir, {
			args: [
				`--disable-extensions-except=${extensionPath}`,
				`--load-extension=${extensionPath}`,
				"--use-fake-device-for-media-stream",
				"--use-fake-ui-for-media-stream",
				"--autoplay-policy=no-user-gesture-required",
			],
			channel: "chromium",
			headless: true,
		});
		await installSupportedBrowserCapabilities(context);
		const responseBodies: Array<{ body: string; url: string }> = [];
		const responseReads: Array<Promise<void>> = [];
		context.on("response", (response) => {
			if (!response.url().startsWith(bffUrl)) return;
			responseReads.push(
				response
					.text()
					.then((body) => {
						responseBodies.push({ body, url: response.url() });
					})
					.catch(() => undefined),
			);
		});
		const worker =
			context.serviceWorkers()[0] ??
			(await context.waitForEvent("serviceworker", { timeout: 10_000 }));
		const extensionId = new URL(worker.url()).host;

		const fixture = await context.newPage();
		await fixture.goto(`${fixtureUrl}/fixture`);
		await fixture.locator("#target").focus();

		const options = await context.newPage();
		await options.goto(`chrome-extension://${extensionId}/options.html`);
		await options.locator("#bff-origin").fill(bffUrl);
		await options.getByRole("button", { name: "Save", exact: true }).click();
		await expect(options.locator("output")).toContainText("Saved");
		expect(
			(await options.evaluate(() => chrome.commands.getAll())).map(
				(command) => command.name,
			),
		).toEqual(
			expect.arrayContaining([
				"toggle-recording",
				"toggle-translation",
				"start-meeting",
			]),
		);
		await options.locator("#default-microphone").selectOption({ index: 1 });
		await options.getByRole("button", { name: "Save microphone" }).click();
		await expect(options.locator("output")).toContainText("microphone");

		const webLogin = await context.newPage();
		await webLogin.goto(`${bffUrl}/`);
		expect(
			await webLogin.evaluate(() => {
				const browser = globalThis as typeof globalThis & {
					SpeechRecognition?: unknown;
					webkitSpeechRecognition?: unknown;
					FileSystemFileHandle?: {
						prototype?: { createSyncAccessHandle?: unknown };
					};
				};
				const browserNavigator = navigator as Navigator & {
					storage?: { getDirectory?: unknown };
				};
				return {
					audioWorklet: typeof browser.AudioWorkletNode === "function",
					displayCaptureAudio:
						typeof navigator.mediaDevices?.getDisplayMedia === "function",
					onDeviceSpeechRecognition:
						typeof browser.SpeechRecognition === "function" ||
						typeof browser.webkitSpeechRecognition === "function",
					opfsSyncAccess:
						typeof browserNavigator.storage?.getDirectory === "function" &&
						typeof browser.FileSystemFileHandle?.prototype
							?.createSyncAccessHandle === "function",
				};
			}),
		).toEqual({
			audioWorklet: true,
			displayCaptureAudio: true,
			onDeviceSpeechRecognition: true,
			opfsSyncAccess: true,
		});
		await webLogin.getByLabel("Email").fill("person@example.com");
		await webLogin.getByRole("button", { name: "Send one-time code" }).click();
		await webLogin.getByLabel("One-time code").fill("123456");
		await webLogin
			.getByRole("button", { name: "Sign in", exact: true })
			.click();
		await expect(webLogin.getByText("person@example.com")).toBeVisible();
		expect((await context.cookies(bffUrl))[0]).toMatchObject({
			httpOnly: true,
		});

		const panel = await context.newPage();
		await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
		const refreshSession = panel.getByRole("button", { name: "I signed in" });
		if (await refreshSession.isVisible()) await refreshSession.click();
		await expect(panel.getByText("person@example.com")).toBeVisible();

		await fixture.bringToFront();
		await fixture.locator("#target").focus();
		await options.evaluate(
			() =>
				new Promise<void>((resolve) => {
					chrome.storage.local.set({ micGranted: true }, resolve);
				}),
		);
		const dictate = async ({
			diarization = false,
			mode = "voice",
		}: {
			diarization?: boolean;
			mode?: "translation" | "voice";
		} = {}) => {
			await panel.evaluate(
				({ diarization: selectedDiarization, mode: selectedMode }) => {
					chrome.runtime.sendMessage({
						diarization: selectedDiarization,
						language: "uk",
						mode: selectedMode,
						type: "start-recording",
						...(selectedMode === "translation"
							? { translation: { targetLanguage: "en" } }
							: {}),
					});
				},
				{ diarization, mode },
			);
			await expect(panel.getByText("Recording...")).toBeVisible();
			await panel.evaluate(() => {
				chrome.runtime.sendMessage({ type: "stop-recording" });
			});
			await expect(panel.getByText("Done")).toBeVisible();
		};
		await dictate({ diarization: true });

		await expect(fixture.locator("#target")).toHaveValue("Mock transcript", {
			timeout: 30_000,
		});
		expect(
			mock
				.realtimeFrames()
				.some((frame) => frame.isBinary && frame.data.length > 0),
		).toBeTruthy();
		expect(
			mock
				.realtimeFrames()
				.some(
					(frame) =>
						!frame.isBinary &&
						typeof frame.data === "string" &&
						frame.data.includes('"enable_speaker_diarization":true'),
				),
		).toBeTruthy();
		await expect
			.poll(() => e2eLibrary.recordings().at(-1)?.segments, {
				timeout: 10_000,
			})
			.toEqual([
				{ endMs: 480, speaker: "1", startMs: 0, text: "Mock transcript" },
			]);
		expect(mock.transcriptions()).toHaveLength(0);

		await fixture.bringToFront();
		await fixture.locator("#target").focus();
		await dictate({ mode: "translation" });
		const transcription = mock.transcriptions().at(-1);
		if (!transcription) throw new Error("Expected extension transcription");
		expect(transcription).toMatchObject({
			authorization: `Bearer ${accessToken}`,
		});
		expect(transcription.bytes).toBeGreaterThan(0);
		const configPart = transcription.body.slice(
			transcription.body.indexOf('name="config"'),
		);
		expect(configPart).toContain("Content-Type: text/plain");
		expect(transcription.body).toContain('"mode":"translate"');
		expect(transcription.body).toContain('"target_language":"en"');

		for (const [editor, selector, expected] of [
			["contenteditable", "#contenteditable", "ContenteditableMock transcript"],
			["notion", "#notion", "NotionMock transcript"],
			["linear", "#linear", "LinearMock transcript"],
			["slack", "#slack", "SlackMock transcript"],
			["prosemirror", "#prosemirror", "ProseMirrorMock transcript"],
			["lexical", "#lexical", "LexicalMock transcript"],
			["quill", "#quill", "Quill Mock transcript"],
		] as const) {
			await fixture.bringToFront();
			await fixture.goto(`${fixtureUrl}/fixture/${editor}`);
			await fixture.locator(selector).evaluate((element) => {
				element.focus();
				const selection = document.getSelection();
				const range = document.createRange();
				range.selectNodeContents(element);
				range.collapse(false);
				selection?.removeAllRanges();
				selection?.addRange(range);
			});
			await dictate();
			await expect(fixture.locator(selector)).toHaveText(expected);
			if (editor === "quill") {
				await expect(fixture.locator("#events")).toContainText("quill:user:6");
			} else if (editor === "lexical") {
				await expect(fixture.locator("#events")).toContainText(
					"beforeinput:insertText:Lexical",
				);
				await expect(fixture.locator("#events")).toContainText(
					"lexical:handled",
				);
			} else {
				await expect(fixture.locator("#events")).toContainText(
					`beforeinput:insertText:${expected.replace("Mock transcript", "")}`,
				);
				await expect(fixture.locator("#events")).toContainText(
					`input:insertText:${expected}`,
				);
			}
		}

		await fixture.bringToFront();
		await fixture.goto(`${fixtureUrl}/fixture/google-docs`);
		await fixture.locator("#google-docs").focus();
		await dictate();
		await expect(
			panel.getByText(
				"Diduny cannot insert into this editor. Copy the transcript instead.",
			),
		).toBeVisible();

		await fixture.bringToFront();
		await fixture.goto(`${fixtureUrl}/fixture`);
		await fixture.locator("#disabled-target").focus();
		await panel.evaluate(() => {
			chrome.runtime.sendMessage({
				diarization: false,
				language: "uk",
				mode: "voice",
				type: "start-recording",
			});
		});
		await expect(panel.getByText("Recording...")).toBeVisible();
		await options.locator("#delivery-site").fill(new URL(fixtureUrl).origin);
		await options.getByRole("button", { name: "Disable site" }).click();
		await expect(
			options.getByText(new URL(fixtureUrl).origin, { exact: true }),
		).toBeVisible();
		await panel.evaluate(() => {
			chrome.runtime.sendMessage({ type: "stop-recording" });
		});
		await expect(panel.getByText("Done")).toBeVisible();
		await expect(fixture.locator("#disabled-target")).toHaveValue("");
		await expect(
			panel.getByText(
				"Delivery is disabled for this site. Copy the transcript instead.",
			),
		).toBeVisible();
		await Promise.all(responseReads);
		const pageStorage = await webLogin.evaluate(() => ({
			cookie: document.cookie,
			localStorage: Object.entries(localStorage),
			sessionStorage: Object.entries(sessionStorage),
		}));
		for (const tokenFragment of tokenFragments) {
			expect(pageStorage.cookie, "document.cookie").not.toContain(
				tokenFragment,
			);
			expect(
				JSON.stringify(pageStorage.localStorage),
				"localStorage",
			).not.toContain(tokenFragment);
			expect(
				JSON.stringify(pageStorage.sessionStorage),
				"sessionStorage",
			).not.toContain(tokenFragment);
			for (const response of responseBodies) {
				expect(
					response.body,
					`response body from ${response.url}`,
				).not.toContain(tokenFragment);
			}
		}
	} finally {
		await context?.close();
		bff.server.closeAllConnections?.();
		mock.server.server.closeAllConnections?.();
		fixtureServer.server.closeAllConnections?.();
		await bff.close();
		await mock.server.close();
		await fixtureServer.close();
		await rm(userDataDir, { force: true, recursive: true });
	}
});
