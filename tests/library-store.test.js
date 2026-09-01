import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryStore } from "../src/server/library-store";

async function withStore(run, options = {}) {
	const dataDir = await mkdtemp(join(tmpdir(), "diduny-library-"));
	const store = await LibraryStore.open({ dataDir, ...options });
	try {
		await run({ dataDir, store });
	} finally {
		await store.close();
		await rm(dataDir, { force: true, recursive: true });
	}
}

function voice(text = "A searchable transcript") {
	return {
		durationSeconds: 1.5,
		status: "transcribed",
		text,
		type: "voice",
	};
}

test("persists audio and searchable summaries without leaking transcript text into the list", async () => {
	await withStore(async ({ dataDir, store }) => {
		const saved = await store.save(voice(), {
			bytes: new TextEncoder().encode("audio"),
			contentType: "audio/webm",
		});

		expect(saved).not.toBeNull();
		const list = await store.list({ search: "searchable" });
		expect(list.items).toHaveLength(1);
		expect(list.items[0]).toMatchObject({ id: saved?.id, type: "voice" });
		expect(list.items[0]).not.toHaveProperty("text");
		expect(await readdir(join(dataDir, "recordings"))).toEqual([
			`${saved?.id}.webm`,
		]);

		const detail = await store.open(saved?.id ?? "");
		expect(detail).toMatchObject({ displayText: "A searchable transcript" });
	});
});

test("keeps browser Opus captures in their seekable WebM container", async () => {
	await withStore(async ({ dataDir, store }) => {
		const saved = await store.save(voice(), {
			bytes: new Uint8Array([1, 2, 3]),
			contentType: "audio/webm;codecs=opus",
		});

		expect(await readdir(join(dataDir, "recordings"))).toEqual([
			`${saved?.id}.webm`,
		]);
	});
});

test("retention never writes a row or a media file", async () => {
	await withStore(async ({ dataDir, store }) => {
		await store.setRetentionPolicy("dictation", "never");
		expect(
			await store.save(voice(), {
				bytes: new Uint8Array([1, 2, 3]),
				contentType: "audio/webm",
			}),
		).toBeNull();
		expect((await store.list()).items).toEqual([]);
		expect(await readdir(join(dataDir, "recordings"))).toEqual([]);
	});
});

test("a failed unlink leaves no library row and reconciliation clears its orphan", async () => {
	let failUnlink = true;
	await withStore(
		async ({ dataDir, store }) => {
			const saved = await store.save(voice(), {
				bytes: new Uint8Array([1]),
				contentType: "audio/webm",
			});
			await store.remove([saved?.id ?? ""]);
			expect(await store.open(saved?.id ?? "")).toBeNull();
			expect(await readdir(join(dataDir, "recordings"))).toHaveLength(1);
			failUnlink = false;
			expect(await store.reconcile()).toEqual({ removedOrphans: 1 });
			expect(await readdir(join(dataDir, "recordings"))).toEqual([]);
		},
		{
			unlink: async (path) => {
				if (failUnlink) throw new Error(`Cannot unlink ${path}`);
				await unlink(path);
			},
		},
	);
});

test("updates recording metadata and keeps title and description searchable", async () => {
	await withStore(async ({ store }) => {
		const saved = await store.save(voice("Original transcript"), {
			bytes: new Uint8Array([1]),
			contentType: "audio/webm",
		});
		const updated = await store.updateMetadata(saved?.id ?? "", {
			description: "Follow-up from the board meeting",
			title: "Board notes",
		});
		expect(updated).toMatchObject({
			description: "Follow-up from the board meeting",
			title: "Board notes",
		});
		expect((await store.list({ search: "board" })).items).toEqual([
			expect.objectContaining({ id: saved?.id, displayTitle: "Board notes" }),
		]);
	});
});
