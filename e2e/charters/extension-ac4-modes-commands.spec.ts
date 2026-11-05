import type { MockProxy } from "../../src/mock-proxy";
import {
	clickRecord,
	clickToolbarButton,
	dispatchCommand,
	expect,
	panelError,
	panelSignedIn,
	realtimeConfigs,
	stateLabel,
	storageSet,
	test,
} from "../support/extension-harness";

// Charter AC4 (extension): every mode in every language pair, started from the
// panel and from its keyboard command (a Bilingual user). Oracle: the config
// the upstream receives names exactly the chosen languages and mode, and a
// pair that translates a language into itself never starts.

type Mode = "voice" | "translation" | "meeting";
const COMMAND: Record<Mode, string> = {
	meeting: "start-meeting",
	translation: "toggle-translation",
	voice: "toggle-recording",
};
const SPOKEN = ["uk", "en", "uk,en"];

const COMBINATIONS: Array<{ language: string; mode: Mode; target?: string }> = [
	...SPOKEN.map((language) => ({ language, mode: "voice" as const })),
	...SPOKEN.flatMap((language) =>
		["en", "uk"]
			.filter((target) => target !== language)
			.map((target) => ({ language, mode: "translation" as const, target })),
	),
	...SPOKEN.map((language) => ({ language, mode: "meeting" as const })),
];

/** The config this start sent: realtime's, or the upload's when realtime was refused (BUG-E23). */
function startedConfig(
	mock: MockProxy,
	realtimeBefore: number,
	uploadsBefore: number,
) {
	const realtime = realtimeConfigs(mock).slice(realtimeBefore)[0];
	if (realtime) return realtime;
	const upload = mock.transcriptions().slice(uploadsBefore)[0]?.body ?? "";
	const json = upload.slice(upload.indexOf("{"), upload.lastIndexOf("}") + 1);
	return JSON.parse(json) as Record<string, unknown>;
}

test("AC4 extension: every mode and language pair, from the panel and from its command", async ({
	extension,
}) => {
	test.setTimeout(420_000);
	const session = await extension({ microphone: "granted", page: "meeting" });
	const { fixture, mock, panel, worker } = session;
	// The toolbar click grants tab capture on the meeting tab for the meetings below.
	await clickToolbarButton(session, fixture);
	const chat = fixture.getByLabel("Chat");

	for (const { language, mode, target } of COMBINATIONS)
		for (const trigger of ["panel", "command"] as const) {
			const label = `${mode} ${language}${target ? `->${target}` : ""} from the ${trigger}`;
			await storageSet(worker, {
				didunyRecordingPreferences: {
					diarization: false,
					language,
					mode,
					translationTargetLanguage:
						target ?? (language === "en" ? "uk" : "en"),
				},
			});
			if (trigger === "panel") {
				await panel.reload();
				await panelSignedIn(panel);
			}
			const realtimeBefore = realtimeConfigs(mock).length;
			const uploadsBefore = mock.transcriptions().length;
			await chat.focus();
			await fixture.bringToFront();
			if (trigger === "panel") await clickRecord(panel);
			else await dispatchCommand(worker, COMMAND[mode]);
			await expect(stateLabel(panel), label).toHaveText("Recording...");
			await fixture.waitForTimeout(1_500);
			if (trigger === "panel") await clickRecord(panel);
			else await dispatchCommand(worker, COMMAND[mode]);
			await expect(stateLabel(panel), label).toHaveText("Done", {
				timeout: 45_000,
			});

			const config = startedConfig(mock, realtimeBefore, uploadsBefore);
			expect(config.language_hints, label).toEqual(language.split(","));
			expect(config.mode, label).toBe(
				mode === "translation" ? "translate" : "transcribe",
			);
			expect(config.enable_speaker_diarization, label).toBe(false);
			if (mode === "translation")
				expect(config.translation, label).toEqual({
					target_language: target,
					type: "one_way",
				});
			else expect(config.translation, label).toBeUndefined();
		}

	// A pair that translates a language into itself is refused before anything records.
	for (const language of ["uk", "en"]) {
		const realtimeBefore = realtimeConfigs(mock).length;
		await panel.evaluate(
			(spoken) =>
				chrome.runtime.sendMessage({
					diarization: false,
					language: spoken,
					mode: "translation",
					translation: { targetLanguage: spoken },
					type: "start-recording",
				}),
			language,
		);
		await expect(panelError(panel)).toHaveText(
			"Choose two different languages to translate between.",
		);
		await fixture.waitForTimeout(500);
		expect(realtimeConfigs(mock)).toHaveLength(realtimeBefore);
	}
});
