import { createReadStream } from "node:fs";
import { PassThrough } from "node:stream";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { ProcessingStatus, RecordingType } from "./src/core/models";
import type {
	LibraryDetail,
	LibraryListOptions,
	LibraryMetadata,
	LibraryPage,
	NewLibraryRecording,
} from "./src/core/ports";
import { type BffAuthGateway, ProxyOtpGateway } from "./src/server/auth";
import type { LibraryExportEntry } from "./src/server/library-store";
import { RealtimeRelay } from "./src/server/realtime-relay";
import {
	extensionSessionCookieName,
	relayRequest,
	sessionCookieName,
	sessionIdFromCookie,
} from "./src/server/relay";
import {
	type BffSession,
	InMemorySessionStore,
	type SessionStore,
} from "./src/server/session-store";
import { type ZipEntry, writeZip } from "./src/server/zip";

export interface ServerOptions {
	auth?: BffAuthGateway;
	fetch?: typeof globalThis.fetch;
	library?: BffLibrary;
	sessions?: SessionStore;
	staticDir?: string;
	upstreamUrl?: string;
}

export interface BffLibrary {
	exportEntries(): AsyncIterable<LibraryExportEntry>;
	list(options?: LibraryListOptions): Promise<LibraryPage>;
	media(id: string): Promise<{
		contentType: string;
		fileSizeBytes: number;
		path: string;
	} | null>;
	open(id: string): Promise<LibraryDetail | null>;
	remove(ids: readonly string[]): Promise<void>;
	saveStream(
		recording: NewLibraryRecording,
		stream: NodeJS.ReadableStream,
		contentType: string,
	): Promise<LibraryDetail | null>;
	updateMetadata(
		id: string,
		metadata: LibraryMetadata,
	): Promise<LibraryDetail | null>;
}

const processingStatuses = [
	"failed",
	"partiallyRecovered",
	"processing",
	"transcribed",
	"translated",
	"unprocessed",
] as const satisfies readonly ProcessingStatus[];
const recordingTypes = [
	"fileTranscription",
	"meeting",
	"meetingTranslation",
	"translation",
	"voice",
] as const satisfies readonly RecordingType[];

function validEmail(email: unknown): email is string {
	return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validOtp(otp: unknown): otp is string {
	return typeof otp === "string" && /^\d{6}$/.test(otp);
}

function sessionCookie(
	name: string,
	id: string,
	path: string,
	sameSite: "Lax" | "None",
	expired = false,
) {
	const expires = expired ? "; Max-Age=0" : "";
	return `${name}=${encodeURIComponent(id)}; Path=${path}; HttpOnly; Secure; SameSite=${sameSite}${expires}`;
}

function sessionCookies(id: string, expired = false) {
	return [
		sessionCookie(sessionCookieName, id, "/", "Lax", expired),
		// Scope the cross-site cookie to extension-only routes. The normal web
		// session stays Lax, while the extension never receives a bearer token.
		sessionCookie(
			extensionSessionCookieName,
			id,
			"/bff/extension/",
			"None",
			expired,
		),
	];
}

function isExtensionRequest(request: FastifyRequest) {
	if (request.headers["sec-fetch-site"] === "none") return true;
	const origin = request.headers.origin;
	return typeof origin === "string" && origin.startsWith("chrome-extension://");
}

function validRecordingId(id: unknown): id is string {
	return (
		typeof id === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
	);
}

function parseRange(range: string | undefined, size: number) {
	if (!range) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(range);
	if (!match) return "invalid";
	const startText = match[1];
	const endText = match[2];
	if (!startText && !endText) return "invalid";
	const start = startText
		? Number(startText)
		: Math.max(size - Number(endText), 0);
	const end = endText ? Number(endText) : size - 1;
	if (
		!Number.isInteger(start) ||
		!Number.isInteger(end) ||
		start < 0 ||
		end < start ||
		start >= size
	) {
		return "invalid";
	}
	return { end: Math.min(end, size - 1), start };
}

function vttTimestamp(milliseconds: number) {
	const total = Math.max(0, Math.round(milliseconds));
	const hours = Math.floor(total / 3_600_000);
	const minutes = Math.floor((total % 3_600_000) / 60_000);
	const seconds = Math.floor((total % 60_000) / 1_000);
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(total % 1_000).padStart(3, "0")}`;
}

function captionText(value: string) {
	return value.replaceAll(/\r?\n/g, " ");
}

function captionsVtt(recording: LibraryDetail) {
	const segments = recording.segments;
	if (segments?.length) {
		return `WEBVTT\n\n${segments
			.map(
				(segment) =>
					`${vttTimestamp(segment.startMs)} --> ${vttTimestamp(Math.max(segment.endMs, segment.startMs + 1))}\n${captionText(segment.text)}`,
			)
			.join("\n\n")}\n`;
	}
	return `WEBVTT\n\n00:00:00.000 --> ${vttTimestamp(
		Math.max(recording.durationSeconds * 1_000, 1),
	)}\n${captionText(recording.displayText)}\n`;
}

async function* libraryArchiveEntries(
	library: BffLibrary,
): AsyncIterable<ZipEntry> {
	yield {
		name: "README.txt",
		source: Buffer.from(
			"Diduny Library Export\n\nEach recordings/<id>/ directory contains portable transcript.txt, metadata.json, transcript-history/*.txt, and the original audio file when it is still present on disk.\n",
		),
	};
	for await (const { media, recording } of library.exportEntries()) {
		const base = `recordings/${recording.id}`;
		yield {
			modifiedAt: recording.createdAt,
			name: `${base}/transcript.txt`,
			source: Buffer.from(recording.displayText),
		};
		yield {
			modifiedAt: recording.createdAt,
			name: `${base}/metadata.json`,
			source: Buffer.from(
				`${JSON.stringify(
					{
						createdAt: recording.createdAt,
						description: recording.description ?? null,
						durationSeconds: recording.durationSeconds,
						id: recording.id,
						status: recording.status,
						title: recording.title ?? null,
						type: recording.type,
					},
					null,
					2,
				)}\n`,
			),
		};
		for (const [index, version] of recording.history.entries()) {
			yield {
				modifiedAt: version.createdAt,
				name: `${base}/transcript-history/${String(index + 1).padStart(2, "0")}-${index === 0 ? "current" : "previous"}.txt`,
				source: Buffer.from(version.text),
			};
		}
		if (media) {
			yield {
				modifiedAt: recording.createdAt,
				name: `${base}/audio/${media.fileName}`,
				source: createReadStream(media.path),
			};
		}
	}
}

function queryValues(value: unknown) {
	return typeof value === "string"
		? value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean)
		: [];
}

function parseLibraryFilter<T extends string>(
	value: unknown,
	allowed: readonly T[],
): readonly T[] | null {
	const values = queryValues(value);
	const matches = values.filter((item): item is T =>
		allowed.includes(item as T),
	);
	return values.length && matches.length === values.length ? matches : null;
}

function isReadableStream(value: unknown): value is NodeJS.ReadableStream {
	return !!value && typeof value === "object" && "pipe" in value;
}

function parseLibraryRecording(value: unknown): NewLibraryRecording | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).some(
			(key) => !["durationSeconds", "status", "text", "type"].includes(key),
		)
	) {
		return null;
	}
	if (
		typeof record.text !== "string" ||
		typeof record.durationSeconds !== "number" ||
		!Number.isFinite(record.durationSeconds) ||
		record.durationSeconds < 0 ||
		typeof record.type !== "string" ||
		!recordingTypes.includes(record.type as RecordingType) ||
		typeof record.status !== "string" ||
		!processingStatuses.includes(record.status as ProcessingStatus)
	) {
		return null;
	}
	return {
		durationSeconds: record.durationSeconds,
		status: record.status as NewLibraryRecording["status"],
		text: record.text,
		type: record.type as NewLibraryRecording["type"],
	};
}

function parseLibraryMetadata(value: unknown): LibraryMetadata | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const metadata = value as Record<string, unknown>;
	const keys = Object.keys(metadata);
	if (
		keys.length === 0 ||
		keys.some((key) => key !== "description" && key !== "title")
	) {
		return null;
	}
	for (const [key, limit] of [
		["title", 500],
		["description", 10_000],
	] as const) {
		const field = metadata[key];
		if (
			key in metadata &&
			field !== null &&
			(typeof field !== "string" || field.length > limit)
		) {
			return null;
		}
	}
	return {
		...("title" in metadata ? { title: metadata.title as string | null } : {}),
		...("description" in metadata
			? { description: metadata.description as string | null }
			: {}),
	};
}

export async function buildServer({
	auth,
	fetch = globalThis.fetch,
	library,
	sessions = new InMemorySessionStore(),
	staticDir,
	upstreamUrl = process.env.DIDUNY_UPSTREAM_URL ?? "http://127.0.0.1:3910",
}: ServerOptions = {}) {
	const server = Fastify({ logger: false });
	const authGateway = auth ?? new ProxyOtpGateway(fetch, upstreamUrl);
	const realtimeRelay = new RealtimeRelay(fetch, sessions, upstreamUrl);
	const refreshes = new Map<string, Promise<BffSession>>();
	const maxPendingLibrarySavesPerSession = 8;
	const pendingLibrarySaves = new Map<
		string,
		{ createdAt: number; recording: NewLibraryRecording; sessionId: string }
	>();
	await server.register(websocket);
	server.addContentTypeParser(
		/^multipart\/form-data/i,
		(_request, payload, done) => {
			done(null, payload);
		},
	);
	server.addContentTypeParser(/^audio\//i, (_request, payload, done) => {
		done(null, payload);
	});
	server.addContentTypeParser(
		/^application\/octet-stream/i,
		(_request, payload, done) => {
			done(null, payload);
		},
	);
	const refreshSession = async (id: string, stale: BffSession) => {
		const current = await sessions.get(id);
		if (!current) throw new Error("session no longer exists");
		if (current.accessToken !== stale.accessToken) return current;
		const inFlight = refreshes.get(id);
		if (inFlight) return inFlight;
		const task = authGateway
			.refresh(current)
			.then(async (next) => {
				await sessions.set(id, next);
				return next;
			})
			.catch(async (error) => {
				await sessions.delete(id);
				throw error;
			});
		refreshes.set(id, task);
		try {
			return await task;
		} finally {
			if (refreshes.get(id) === task) refreshes.delete(id);
		}
	};

	const relay = async (
		request: FastifyRequest,
		reply: FastifyReply,
		cookieName = sessionCookieName,
	) => {
		const result = await relayRequest({
			cookieName,
			fetch,
			refreshSession,
			request,
			sessions,
			upstreamUrl,
		});
		if (result.kind === "not_found") {
			return reply.code(404).send({ error: "not_found" });
		}
		if (result.kind === "unauthenticated") {
			return reply.code(401).send({ error: "unauthenticated" });
		}
		if (result.kind === "unreachable") {
			return reply.code(502).send({ error: "upstream_unreachable" });
		}
		for (const [name, value] of Object.entries(result.headers))
			reply.header(name, value);
		return reply.code(result.status).send(result.body);
	};

	const sessionResponse = async (
		request: FastifyRequest,
		cookieName = sessionCookieName,
	) => {
		const id = sessionIdFromCookie(request.headers.cookie, cookieName);
		const session = id ? await sessions.get(id) : null;
		return session
			? {
					authenticated: true,
					...(session.email ? { email: session.email } : {}),
				}
			: { authenticated: false };
	};

	const logout = async (
		request: FastifyRequest,
		reply: FastifyReply,
		cookieName = sessionCookieName,
	) => {
		const id = sessionIdFromCookie(request.headers.cookie, cookieName);
		const session = id ? await sessions.get(id) : null;
		if (id) await sessions.delete(id);
		reply.header("set-cookie", sessionCookies("", true));
		if (session) await authGateway.logout(session).catch(() => undefined);
		return reply.code(204).send();
	};
	const requireSession = async (
		request: FastifyRequest,
		reply: FastifyReply,
		cookieName = sessionCookieName,
		extensionOnly = false,
	) => {
		if (extensionOnly && !isExtensionRequest(request)) {
			reply.code(403).send({ error: "extension_origin_required" });
			return null;
		}
		const id = sessionIdFromCookie(request.headers.cookie, cookieName);
		if (!id || !(await sessions.get(id))) {
			reply.code(401).send({ error: "unauthenticated" });
			return null;
		}
		return id;
	};

	server.get("/bff/health", async () => ({
		activeRealtimeSockets: realtimeRelay.activeUpstreamSockets,
		status: "ok",
	}));
	server.post("/bff/auth/send-otp", async (request, reply) => {
		const email = (request.body as { email?: unknown } | undefined)?.email;
		if (!validEmail(email))
			return reply.code(400).send({ error: "invalid_email" });
		try {
			await authGateway.sendOtp(email);
			return reply.code(204).send();
		} catch {
			return reply.code(502).send({ error: "upstream_auth_unavailable" });
		}
	});
	server.post("/bff/auth/verify-otp", async (request, reply) => {
		const payload = request.body as
			| { email?: unknown; otp?: unknown }
			| undefined;
		if (!validEmail(payload?.email) || !validOtp(payload?.otp)) {
			return reply.code(400).send({ error: "invalid_otp_verification" });
		}
		try {
			const session = await authGateway.verifyOtp(payload.email, payload.otp);
			const id = await sessions.create(session);
			reply.header("set-cookie", sessionCookies(id));
			return { email: session.email };
		} catch {
			return reply.code(401).send({ error: "otp_verification_failed" });
		}
	});
	server.get("/bff/auth/session", (request) => sessionResponse(request));
	server.post("/bff/auth/logout", (request, reply) => logout(request, reply));
	server.all("/bff/api/*", (request, reply) => relay(request, reply));
	if (library) {
		const stageLibrarySave = (
			request: FastifyRequest,
			reply: FastifyReply,
			sessionId: string,
		) => {
			const recording = parseLibraryRecording(request.body);
			if (!recording) {
				return reply.code(400).send({ error: "invalid_recording" });
			}
			const now = Date.now();
			let pendingForSession = 0;
			for (const [id, pending] of pendingLibrarySaves) {
				if (pending.createdAt < now - 10 * 60 * 1000)
					pendingLibrarySaves.delete(id);
				else if (pending.sessionId === sessionId) pendingForSession += 1;
			}
			if (pendingForSession >= maxPendingLibrarySavesPerSession) {
				return reply.code(429).send({ error: "too_many_pending_recordings" });
			}
			const id = crypto.randomUUID();
			pendingLibrarySaves.set(id, {
				createdAt: now,
				recording,
				sessionId,
			});
			return reply.code(201).send({ id });
		};
		const saveStagedLibraryAudio = async (
			request: FastifyRequest,
			reply: FastifyReply,
			sessionId: string,
		) => {
			const id = (request.params as { id?: unknown }).id;
			if (!validRecordingId(id))
				return reply.code(400).send({ error: "invalid_recording_id" });
			const pending = pendingLibrarySaves.get(id);
			if (!pending || pending.sessionId !== sessionId) {
				return reply.code(404).send({ error: "pending_recording_not_found" });
			}
			const contentType = request.headers["content-type"];
			if (
				typeof contentType !== "string" ||
				!contentType.startsWith("audio/")
			) {
				return reply.code(415).send({ error: "audio_content_type_required" });
			}
			if (!isReadableStream(request.body)) {
				return reply.code(415).send({ error: "audio_stream_required" });
			}
			try {
				const saved = await library.saveStream(
					pending.recording,
					request.body,
					contentType,
				);
				pendingLibrarySaves.delete(id);
				return reply.code(201).send(saved ?? { saved: false });
			} catch {
				return reply.code(500).send({ error: "library_save_failed" });
			}
		};
		server.post("/bff/library", async (request, reply) => {
			const sessionId = await requireSession(request, reply);
			if (!sessionId) return;
			return stageLibrarySave(request, reply, sessionId);
		});
		server.put("/bff/library/:id/media", async (request, reply) => {
			const sessionId = await requireSession(request, reply);
			if (!sessionId) return;
			return saveStagedLibraryAudio(request, reply, sessionId);
		});
		server.post("/bff/extension/library", async (request, reply) => {
			const sessionId = await requireSession(
				request,
				reply,
				extensionSessionCookieName,
				true,
			);
			if (!sessionId) return;
			return stageLibrarySave(request, reply, sessionId);
		});
		server.put("/bff/extension/library/:id/media", async (request, reply) => {
			const sessionId = await requireSession(
				request,
				reply,
				extensionSessionCookieName,
				true,
			);
			if (!sessionId) return;
			return saveStagedLibraryAudio(request, reply, sessionId);
		});
		server.get("/bff/library", async (request, reply) => {
			if (!(await requireSession(request, reply))) return;
			const query = request.query as {
				limit?: string;
				offset?: string;
				search?: string;
				status?: string;
				type?: string;
			};
			const limit = query.limit ? Number(query.limit) : undefined;
			const offset = query.offset ? Number(query.offset) : undefined;
			const status = query.status
				? parseLibraryFilter(query.status, processingStatuses)
				: undefined;
			const type = query.type
				? parseLibraryFilter(query.type, recordingTypes)
				: undefined;
			if (
				(limit !== undefined && (!Number.isInteger(limit) || limit < 1)) ||
				(offset !== undefined && (!Number.isInteger(offset) || offset < 0)) ||
				status === null ||
				type === null
			) {
				return reply.code(400).send({
					error:
						status === null || type === null
							? "invalid_library_filter"
							: "invalid_pagination",
				});
			}
			return library.list({
				...(limit === undefined ? {} : { limit }),
				...(offset === undefined ? {} : { offset }),
				...(query.search ? { search: query.search } : {}),
				...(status ? { status } : {}),
				...(type ? { type } : {}),
			});
		});
		server.get("/bff/library/export", async (request, reply) => {
			if (!(await requireSession(request, reply))) return;
			const archive = new PassThrough();
			void writeZip(archive, libraryArchiveEntries(library)).catch((error) =>
				archive.destroy(
					error instanceof Error ? error : new Error("export_failed"),
				),
			);
			return reply
				.header(
					"content-disposition",
					'attachment; filename="diduny-library.zip"',
				)
				.header("content-type", "application/zip")
				.send(archive);
		});
		server.get("/bff/library/:id", async (request, reply) => {
			if (!(await requireSession(request, reply))) return;
			const id = (request.params as { id?: unknown }).id;
			if (!validRecordingId(id))
				return reply.code(400).send({ error: "invalid_recording_id" });
			const detail = await library.open(id);
			return detail
				? detail
				: reply.code(404).send({ error: "recording_not_found" });
		});
		server.patch("/bff/library/:id", async (request, reply) => {
			if (!(await requireSession(request, reply))) return;
			const id = (request.params as { id?: unknown }).id;
			if (!validRecordingId(id))
				return reply.code(400).send({ error: "invalid_recording_id" });
			const metadata = parseLibraryMetadata(request.body);
			if (!metadata)
				return reply.code(400).send({ error: "invalid_recording_metadata" });
			const detail = await library.updateMetadata(id, metadata);
			return detail
				? detail
				: reply.code(404).send({ error: "recording_not_found" });
		});
		server.delete("/bff/library/:id", async (request, reply) => {
			if (!(await requireSession(request, reply))) return;
			const id = (request.params as { id?: unknown }).id;
			if (!validRecordingId(id))
				return reply.code(400).send({ error: "invalid_recording_id" });
			await library.remove([id]);
			return reply.code(204).send();
		});
		server.get("/bff/library/:id/captions.vtt", async (request, reply) => {
			if (!(await requireSession(request, reply))) return;
			const id = (request.params as { id?: unknown }).id;
			if (!validRecordingId(id))
				return reply.code(400).send({ error: "invalid_recording_id" });
			const recording = await library.open(id);
			if (!recording)
				return reply.code(404).send({ error: "recording_not_found" });
			return reply
				.header("cache-control", "private, no-store")
				.type("text/vtt; charset=utf-8")
				.send(captionsVtt(recording));
		});
		server.get("/bff/library/:id/media", async (request, reply) => {
			if (!(await requireSession(request, reply))) return;
			const id = (request.params as { id?: unknown }).id;
			if (!validRecordingId(id))
				return reply.code(400).send({ error: "invalid_recording_id" });
			const media = await library.media(id);
			if (!media) return reply.code(404).send({ error: "media_not_found" });
			const range = parseRange(request.headers.range, media.fileSizeBytes);
			if (range === "invalid") {
				return reply
					.code(416)
					.header("content-range", `bytes */${media.fileSizeBytes}`)
					.send();
			}
			if (!range) {
				return reply
					.header("accept-ranges", "bytes")
					.header("content-length", media.fileSizeBytes)
					.header("content-type", media.contentType)
					.send(createReadStream(media.path));
			}
			return reply
				.code(206)
				.header("accept-ranges", "bytes")
				.header("content-length", range.end - range.start + 1)
				.header(
					"content-range",
					`bytes ${range.start}-${range.end}/${media.fileSizeBytes}`,
				)
				.header("content-type", media.contentType)
				.send(createReadStream(media.path, range));
		});
	}
	server.get("/bff/extension/auth/session", async (request, reply) => {
		if (!isExtensionRequest(request)) {
			return reply.code(403).send({ error: "extension_origin_required" });
		}
		return sessionResponse(request, extensionSessionCookieName);
	});
	server.post("/bff/extension/auth/logout", async (request, reply) => {
		if (!isExtensionRequest(request)) {
			return reply.code(403).send({ error: "extension_origin_required" });
		}
		return logout(request, reply, extensionSessionCookieName);
	});
	server.all("/bff/extension/api/*", async (request, reply) => {
		if (!isExtensionRequest(request)) {
			return reply.code(403).send({ error: "extension_origin_required" });
		}
		return relay(request, reply, extensionSessionCookieName);
	});
	server.get(
		"/bff/realtime",
		{
			preValidation: (request, reply) =>
				realtimeRelay.authorizeUpgrade(request, reply),
			websocket: true,
		},
		(socket, request) => realtimeRelay.connect(socket, request),
	);
	server.get(
		"/bff/extension/realtime",
		{
			preValidation: async (request, reply) => {
				if (!isExtensionRequest(request)) {
					reply.code(403).send({ error: "extension_origin_required" });
					return;
				}
				await realtimeRelay.authorizeUpgrade(
					request,
					reply,
					extensionSessionCookieName,
				);
			},
			websocket: true,
		},
		(socket, request) => realtimeRelay.connect(socket, request),
	);

	if (staticDir) {
		await server.register(fastifyStatic, { root: staticDir });
		server.setNotFoundHandler((request, reply) => {
			if (request.url.startsWith("/bff/")) {
				return reply.code(404).send({ error: "Not found" });
			}
			return reply.sendFile("index.html");
		});
	}

	return server;
}
