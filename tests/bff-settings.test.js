import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../server";
import { LibraryStore } from "../src/server/library-store";
import { InMemorySessionStore } from "../src/server/session-store";

test("persists workspace settings and reports server-side library statistics and disk space", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "diduny-bff-settings-"));
	const library = await LibraryStore.open({ dataDir });
	const sessions = new InMemorySessionStore();
	const sessionId = await sessions.create({ accessToken: "server-only" });
	const server = await buildServer({ library, sessions });
	const cookie = `diduny_session=${sessionId}`;
	try {
		const unauthenticated = await server.inject({
			method: "GET",
			url: "/bff/settings",
		});
		expect(unauthenticated.statusCode).toBe(401);

		const initial = await server.inject({
			headers: { cookie },
			method: "GET",
			url: "/bff/settings",
		});
		expect(initial.statusCode).toBe(200);
		expect(initial.json()).toEqual(
			expect.objectContaining({
				settings: expect.objectContaining({
					typingSpeedWordsPerMinute: null,
				}),
				storage: expect.objectContaining({
					dataDir,
					freeBytes: expect.any(Number),
					usedBytes: expect.any(Number),
				}),
			}),
		);

		const updated = await server.inject({
			headers: { cookie },
			method: "PATCH",
			payload: {
				fillerWords: ["um", "uh", "diduny"],
				protectedLexicon: ["Diduny"],
				textCleanupEnabled: true,
				typingSpeedWordsPerMinute: 60,
			},
			url: "/bff/settings",
		});
		expect(updated.statusCode).toBe(200);
		expect(updated.json()).toEqual(
			expect.objectContaining({
				protectedLexicon: ["Diduny"],
				typingSpeedWordsPerMinute: 60,
			}),
		);

		const retention = await server.inject({
			headers: { cookie },
			method: "PUT",
			payload: { category: "dictation", policy: "days30" },
			url: "/bff/settings/retention",
		});
		expect(retention.statusCode).toBe(200);
		expect(retention.json()).toEqual({
			dictation: "days30",
			meeting: "forever",
		});

		const saved = await library.save(
			{
				durationSeconds: 2,
				status: "transcribed",
				text: "Um Diduny uh writes notes",
				type: "voice",
			},
			{
				bytes: new TextEncoder().encode("settings-audio"),
				contentType: "audio/webm",
			},
		);
		expect(saved?.displayText).toBe("Diduny writes notes");

		const current = await server.inject({
			headers: { cookie },
			method: "GET",
			url: "/bff/settings",
		});
		expect(current.json()).toEqual(
			expect.objectContaining({
				retention: { dictation: "days30", meeting: "forever" },
				stats: expect.objectContaining({
					dictationDurationSeconds: 2,
					timeSavedSeconds: 1,
					wordCount: 3,
				}),
			}),
		);
	} finally {
		await server.close();
		await library.close();
		await rm(dataDir, { force: true, recursive: true });
	}
});
