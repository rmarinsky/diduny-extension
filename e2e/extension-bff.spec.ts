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
	const extensionLibraryPosts: Array<{
		idempotencyKey: string | undefined;
		status: number;
	}> = [];

	const bff = await buildServer({
		library: e2eLibrary.library,
		staticDir: resolve("web/dist"),
		upstreamUrl,
	});
	bff.addHook("onResponse", async (request, reply) => {
		if (request.method !== "POST" || request.url !== "/bff/extension/library")
			return;
		const idempotencyKey = request.headers["idempotency-key"];
		extensionLibraryPosts.push({
			idempotencyKey:
				typeof idempotencyKey === "string" ? idempotencyKey : undefined,
			status: reply.statusCode,
		});
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

		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: new URL(fixtureUrl).origin,
		});
		const fixture = await context.newPage();
		await fixture.goto(`${fixtureUrl}/fixture`);
		await fixture.locator("#target").focus();
		await fixture.evaluate(() =>
			navigator.clipboard.writeText("clipboard must remain unchanged"),
		);

		const options = await context.newPage();
		await options.goto(`chrome-extension://${extensionId}/options.html`);
		await options.locator("#bff-origin").fill(bffUrl);
		await options.getByRole("button", { name: "Save", exact: true }).click();
		await expect(options.locator("output")).toContainText("Saved");
		const registeredCommands = await options.evaluate(() =>
			chrome.commands.getAll(),
		);
		expect(registeredCommands.map((command) => command.name)).toEqual(
			expect.arrayContaining([
				"toggle-recording",
				"toggle-translation",
				"start-meeting",
			]),
		);
		expect(
			registeredCommands.find((command) => command.name === "toggle-recording")
				?.shortcut,
		).toBeTruthy();
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
		const savedTranscriptCount = () =>
			panel.evaluate(
				() =>
					new Promise<number>((resolve) => {
						chrome.storage.local.get("diduny_transcripts", (result) => {
							resolve(
								Array.isArray(result.diduny_transcripts)
									? result.diduny_transcripts.length
									: 0,
							);
						});
					}),
			);
		const terminalCaptureId = () =>
			panel.evaluate(
				() =>
					new Promise<string | undefined>((resolve) => {
						chrome.storage.session.get(
							"didunyCaptureTerminalState",
							(result) => {
								const state = result.didunyCaptureTerminalState;
								resolve(
									state && typeof state.captureId === "string"
										? state.captureId
										: undefined,
								);
							},
						);
					}),
			);
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
		await expect.poll(savedTranscriptCount).toBe(1);
		expect(await fixture.evaluate(() => navigator.clipboard.readText())).toBe(
			"clipboard must remain unchanged",
		);

		const targetBeforeCaptureReplay = await fixture
			.locator("#target")
			.inputValue();
		const recordingsBeforeCaptureReplay = e2eLibrary.recordings().length;
		const savedTranscriptCountBeforeCaptureReplay =
			await savedTranscriptCount();
		const replayCaptureId = await terminalCaptureId();
		if (!replayCaptureId)
			throw new Error("Expected a completed capture id for replay");
		await panel.evaluate((captureId) => {
			chrome.runtime.sendMessage({
				captureId,
				source: "mic",
				text: "Mock transcript",
				type: "capture-complete",
			});
			chrome.runtime.sendMessage({
				captureId,
				source: "mic",
				type: "capture-persisted",
			});
		}, replayCaptureId);
		await expect(panel.getByText("Done")).toBeVisible();

		await fixture.bringToFront();
		await fixture.locator("#target").focus();
		await panel.evaluate(() => {
			chrome.runtime.sendMessage({
				diarization: false,
				language: "uk",
				mode: "voice",
				type: "start-recording",
			});
		});
		await expect(panel.getByText("Recording...")).toBeVisible();
		await fixture.locator("#disabled-target").focus();
		await panel.evaluate(() => {
			chrome.runtime.sendMessage({ type: "stop-recording" });
		});
		await expect(panel.getByText("Done")).toBeVisible();
		await expect(fixture.locator("#target")).toHaveValue(
			`${targetBeforeCaptureReplay}Mock transcript`,
		);
		await expect(fixture.locator("#disabled-target")).toHaveValue("");
		await expect
			.poll(() => e2eLibrary.recordings().length)
			.toBe(recordingsBeforeCaptureReplay + 1);
		await expect
			.poll(savedTranscriptCount)
			.toBe(savedTranscriptCountBeforeCaptureReplay + 1);

		const recordingsBeforeDuplicateStart = e2eLibrary.recordings().length;
		const targetBeforeDuplicateStart = await fixture
			.locator("#target")
			.inputValue();
		const realtimeConfigsBeforeDuplicateStart = () =>
			mock
				.realtimeFrames()
				.filter(
					(frame) =>
						!frame.isBinary &&
						typeof frame.data === "string" &&
						frame.data.includes('"audio_format"'),
				).length;
		const configCountBeforeDuplicateStart =
			realtimeConfigsBeforeDuplicateStart();
		await fixture.bringToFront();
		await fixture.locator("#target").focus();
		await panel.evaluate(() => {
			const start = {
				diarization: false,
				language: "uk",
				mode: "voice",
				type: "start-recording",
			};
			chrome.runtime.sendMessage(start);
			chrome.runtime.sendMessage(start);
		});
		await expect(panel.getByText("Recording...")).toBeVisible();
		await panel.evaluate(() => {
			chrome.runtime.sendMessage({ type: "stop-recording" });
		});
		await expect(panel.getByText("Done")).toBeVisible();
		await expect
			.poll(() => e2eLibrary.recordings().length)
			.toBe(recordingsBeforeDuplicateStart + 1);
		await expect(fixture.locator("#target")).toHaveValue(
			`${targetBeforeDuplicateStart}Mock transcript`,
		);
		expect(realtimeConfigsBeforeDuplicateStart()).toBe(
			configCountBeforeDuplicateStart + 1,
		);

		const recordingsBeforeWorkerTermination = e2eLibrary.recordings().length;
		const targetBeforeWorkerTermination = await fixture
			.locator("#target")
			.inputValue();
		await fixture.bringToFront();
		await fixture.locator("#target").focus();
		await panel.evaluate(() => {
			chrome.runtime.sendMessage({
				diarization: false,
				language: "uk",
				mode: "voice",
				type: "start-recording",
			});
		});
		await expect(panel.getByText("Recording...")).toBeVisible();
		const cdp = await context.newCDPSession(panel);
		const workerVersions = new Map<
			string,
			{ runningStatus: string; scriptURL: string; versionId: string }
		>();
		cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
			for (const version of versions)
				workerVersions.set(version.versionId, version);
		});
		await cdp.send("ServiceWorker.enable");
		const didunyWorker = () =>
			[...workerVersions.values()].find((version) =>
				version.scriptURL.startsWith(`chrome-extension://${extensionId}/`),
			);
		await expect
			.poll(() => didunyWorker()?.runningStatus, { timeout: 10_000 })
			.toBe("running");
		const runningWorker = didunyWorker();
		if (!runningWorker)
			throw new Error("Could not find the Diduny service-worker version");
		await cdp.send("ServiceWorker.stopWorker", {
			versionId: runningWorker.versionId,
		});
		await expect
			.poll(() => didunyWorker()?.runningStatus, { timeout: 10_000 })
			.toBe("stopped");
		await panel.evaluate(
			() =>
				new Promise((resolve) =>
					chrome.runtime.sendMessage({ type: "getBffSession" }, resolve),
				),
		);
		await expect
			.poll(() => didunyWorker()?.runningStatus, { timeout: 10_000 })
			.toBe("running");
		await panel.evaluate(() => {
			chrome.runtime.sendMessage({ type: "stop-recording" });
		});
		await expect(panel.getByText("Done")).toBeVisible();
		await expect
			.poll(() => e2eLibrary.recordings().length)
			.toBe(recordingsBeforeWorkerTermination + 1);
		await expect(fixture.locator("#target")).toHaveValue(
			`${targetBeforeWorkerTermination}Mock transcript`,
		);

		const recordingsBeforeAmbiguousLibraryFailure =
			e2eLibrary.recordings().length;
		const librarySaveIdsBeforeAmbiguousLibraryFailure =
			e2eLibrary.saveRecordingIds().length;
		const libraryPostsBeforeAmbiguousLibraryFailure =
			extensionLibraryPosts.length;
		const binaryRealtimeFramesBeforeAmbiguousLibraryFailure = mock
			.realtimeFrames()
			.filter((frame) => frame.isBinary && frame.data.length > 0).length;
		e2eLibrary.failNextSave();
		await fixture.bringToFront();
		await fixture.locator("#target").focus();
		await panel.evaluate(() => {
			chrome.runtime.sendMessage({
				diarization: false,
				language: "uk",
				mode: "voice",
				type: "start-recording",
			});
		});
		await expect(panel.getByText("Recording...")).toBeVisible();
		await expect
			.poll(
				() =>
					mock
						.realtimeFrames()
						.filter((frame) => frame.isBinary && frame.data.length > 0).length,
				{ timeout: 10_000 },
			)
			.toBeGreaterThan(binaryRealtimeFramesBeforeAmbiguousLibraryFailure);
		await panel.evaluate(() => {
			chrome.runtime.sendMessage({ type: "stop-recording" });
		});
		await expect(panel.getByText("Error", { exact: true })).toBeVisible();
		await expect
			.poll(() => e2eLibrary.recordings().length)
			.toBe(recordingsBeforeAmbiguousLibraryFailure + 1);
		const failedRecording = e2eLibrary.recordings().at(-1);
		if (!failedRecording)
			throw new Error("Expected the ambiguous library save to persist a row");
		expect(
			e2eLibrary
				.saveRecordingIds()
				.slice(librarySaveIdsBeforeAmbiguousLibraryFailure),
		).toEqual([failedRecording.id]);
		expect(
			extensionLibraryPosts
				.slice(libraryPostsBeforeAmbiguousLibraryFailure)
				.filter((post) => post.idempotencyKey === failedRecording.id),
		).toEqual([{ idempotencyKey: failedRecording.id, status: 201 }]);

		await fixture.bringToFront();
		await fixture.locator("#target").focus();
		await dictate();
		await expect
			.poll(() => e2eLibrary.recordings().length)
			.toBe(recordingsBeforeAmbiguousLibraryFailure + 2);
		await expect
			.poll(
				() =>
					extensionLibraryPosts
						.slice(libraryPostsBeforeAmbiguousLibraryFailure)
						.filter((post) => post.idempotencyKey === failedRecording.id)
						.length,
			)
			.toBe(2);
		const recoveryRows = e2eLibrary
			.recordings()
			.slice(recordingsBeforeAmbiguousLibraryFailure);
		expect(
			recoveryRows.filter((row) => row.id === failedRecording.id),
		).toHaveLength(1);
		expect(
			recoveryRows.find((row) => row.id === failedRecording.id),
		).toMatchObject({ status: "transcribed" });
		expect(new Set(recoveryRows.map((row) => row.id)).size).toBe(2);
		expect(
			extensionLibraryPosts
				.slice(libraryPostsBeforeAmbiguousLibraryFailure)
				.filter((post) => post.idempotencyKey === failedRecording.id),
		).toEqual([
			{ idempotencyKey: failedRecording.id, status: 201 },
			{ idempotencyKey: failedRecording.id, status: 200 },
		]);
		expect(
			e2eLibrary
				.saveRecordingIds()
				.slice(librarySaveIdsBeforeAmbiguousLibraryFailure)
				.filter((id) => id === failedRecording.id),
		).toHaveLength(1);

		await fixture.bringToFront();
		await fixture.locator("#target").focus();
		await dictate({ mode: "translation" });
		expect(
			extensionLibraryPosts
				.slice(libraryPostsBeforeAmbiguousLibraryFailure)
				.filter((post) => post.idempotencyKey === failedRecording.id),
		).toHaveLength(2);
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
		const extensionStorage = await panel.evaluate(
			() =>
				new Promise<{ local: object; session: object }>((resolve) => {
					chrome.storage.local.get(null, (local) => {
						chrome.storage.session.get(null, (session) =>
							resolve({ local, session }),
						);
					});
				}),
		);
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
			expect(
				JSON.stringify(extensionStorage),
				"extension storage",
			).not.toContain(tokenFragment);
			for (const response of responseBodies) {
				expect(
					response.body,
					`response body from ${response.url}`,
				).not.toContain(tokenFragment);
			}
		}
		await webLogin.getByRole("button", { name: "Sign out" }).click();
		await expect(webLogin.getByLabel("Email")).toBeVisible();
		expect(
			await panel.evaluate(
				() =>
					new Promise((resolve) =>
						chrome.runtime.sendMessage({ type: "getBffSession" }, resolve),
					),
			),
		).toEqual({ authenticated: false });
		await panel.bringToFront();
		// Headless Chromium does not emit focus for extension pages.
		await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
		await expect(
			panel.getByRole("button", { name: "Open Diduny sign-in" }),
		).toBeVisible();
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
