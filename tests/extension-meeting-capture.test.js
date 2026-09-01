import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("uses tabCapture with durable recovery instead of a screen picker", async () => {
	const [background, capture, offscreen, mixer, tabCapture] = await Promise.all(
		[
			readFile("entrypoints/background.ts", "utf8"),
			readFile("web/src/capture.ts", "utf8"),
			readFile("entrypoints/offscreen/main.ts", "utf8"),
			readFile("lib/audio/mixer.ts", "utf8"),
			readFile("lib/audio/tab-capture.ts", "utf8"),
		],
	);

	expect(background).toContain("chrome.tabCapture");
	expect(background).not.toContain("desktopCapture");
	expect(tabCapture).toContain('chromeMediaSource: "tab"');
	expect(offscreen).toContain("createScratchStorage");
	expect(offscreen).toContain("partiallyRecovered");
	expect(offscreen).toContain("recoverPartialCapture");
	expect(offscreen).toContain("watchForStreamEnd");
	const pipelineStart = offscreen.indexOf(
		"pipelines = [pipeline];",
		offscreen.indexOf("const pipeline = await createPipeline"),
	);
	expect(pipelineStart).toBeGreaterThan(-1);
	expect(pipelineStart).toBeLessThan(
		offscreen.indexOf("watchForStreamEnd(tabStream"),
	);
	expect(capture).toContain("closeAudioContexts");
	expect(mixer).toContain("tabGain.connect(context.destination)");
});
