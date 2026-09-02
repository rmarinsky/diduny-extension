import type { AudioBytes, AudioRecorderPort } from "./ports";

export type SessionState =
	| "error"
	| "idle"
	| "processing"
	| "recording"
	| "success";

export interface SessionResult {
	audio: AudioBytes;
	id: string;
	text: string;
}

export interface SessionDependencies {
	audio: Pick<AudioRecorderPort, "cancel" | "start" | "stop">;
	cleanup(text: string): Promise<void>;
	deliver(text: string): void;
	finalize(sessionId: string): Promise<string>;
	refreshUsage(): Promise<void>;
	save(result: SessionResult): Promise<void>;
	updateStored(result: SessionResult): Promise<void>;
}

export class SessionMachine {
	private activeSessionId: string | null = null;
	private background = new Set<Promise<void>>();
	private latestSessionId: string | null = null;
	private sequence = 0;
	state: SessionState = "idle";

	constructor(private readonly dependencies: SessionDependencies) {}

	async start(): Promise<string> {
		if (this.activeSessionId) throw new Error("capture is already active");
		const sessionId = String(++this.sequence);
		this.activeSessionId = sessionId;
		this.latestSessionId = sessionId;
		this.state = "recording";
		await this.dependencies.audio.start(null);
		return sessionId;
	}

	async stop() {
		const sessionId = this.activeSessionId;
		if (!sessionId) throw new Error("no capture is active");

		// Finalization is deliberately started before stopping capture.
		const finalizedText = this.dependencies.finalize(sessionId);
		this.activeSessionId = null;
		this.state = "processing";

		try {
			const audio = await this.dependencies.audio.stop();
			const result = { audio, id: sessionId, text: await finalizedText };
			if (this.latestSessionId === sessionId && !this.activeSessionId) {
				this.dependencies.deliver(result.text);
				this.state = "success";
			}
			this.runBelowCutLine(result);
		} catch (error) {
			if (this.latestSessionId === sessionId && !this.activeSessionId) {
				this.state = "error";
			}
			throw error;
		}
	}

	async applyServerRefinement(sessionId: string, text: string) {
		await this.dependencies.updateStored({
			audio: new Uint8Array(),
			id: sessionId,
			text,
		});
	}

	async waitForBackground() {
		await Promise.all(this.background);
	}

	private runBelowCutLine(result: SessionResult) {
		const task = Promise.allSettled([
			this.dependencies.save(result),
			this.dependencies.refreshUsage(),
			this.dependencies.cleanup(result.text),
		]).then(() => undefined);
		this.background.add(task);
		void task.finally(() => this.background.delete(task));
	}
}
