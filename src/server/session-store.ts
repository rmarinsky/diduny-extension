import type { Database as BunDatabase } from "bun:sqlite";
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function openBunDatabase(path: string): BunDatabase {
	const { Database } = require("bun:sqlite") as {
		Database: new (filename: string) => BunDatabase;
	};
	return new Database(path);
}

export interface BffSession {
	accessToken: string;
	email?: string;
	expiresAt?: number;
	refreshToken?: string;
}

export interface SessionStore {
	create(session: BffSession): Promise<string>;
	delete(id: string): Promise<void>;
	get(id: string): Promise<BffSession | null>;
	set(id: string, session: BffSession): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
	private readonly sessions = new Map<string, BffSession>();

	async create(session: BffSession) {
		const id = crypto.randomUUID();
		this.sessions.set(id, session);
		return id;
	}

	async delete(id: string) {
		this.sessions.delete(id);
	}

	async get(id: string) {
		return this.sessions.get(id) ?? null;
	}

	async set(id: string, session: BffSession) {
		this.sessions.set(id, session);
	}
}

type SessionRow = {
	access_token: string;
	email: string | null;
	expires_at: number | null;
	id: string;
	refresh_token: string | null;
};

function sessionEncryptionKey(secret: string) {
	if (!secret) throw new Error("BFF session secret is required");
	return createHash("sha256").update(secret).digest();
}

function encrypt(value: string, key: Buffer) {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const ciphertext = Buffer.concat([
		cipher.update(value, "utf8"),
		cipher.final(),
	]);
	return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

function decrypt(value: string, key: Buffer) {
	if (!value.startsWith("v1:")) return value;
	const [version, iv, tag, ciphertext, extra] = value.split(":");
	if (version !== "v1" || !iv || !tag || !ciphertext || extra)
		throw new Error("invalid encrypted BFF session value");
	const decipher = createDecipheriv(
		"aes-256-gcm",
		key,
		Buffer.from(iv, "base64url"),
	);
	decipher.setAuthTag(Buffer.from(tag, "base64url"));
	return Buffer.concat([
		decipher.update(Buffer.from(ciphertext, "base64url")),
		decipher.final(),
	]).toString("utf8");
}

export class SqliteSessionStore implements SessionStore {
	private readonly database: BunDatabase;
	private readonly key: Buffer;

	constructor(path: string, secret: string) {
		this.key = sessionEncryptionKey(secret);
		this.database = openBunDatabase(path);
		chmodSync(path, 0o600);
		this.database.exec("PRAGMA foreign_keys = ON");
		this.database.exec("PRAGMA busy_timeout = 5000");
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS bff_sessions (
				id TEXT PRIMARY KEY,
				access_token TEXT NOT NULL,
				refresh_token TEXT,
				expires_at INTEGER,
				email TEXT
			)
		`);
		this.encryptExistingSessions();
	}

	async create(session: BffSession) {
		const id = crypto.randomUUID();
		await this.set(id, session);
		return id;
	}

	close() {
		this.database.close();
	}

	async delete(id: string) {
		this.database.run("DELETE FROM bff_sessions WHERE id = ?", [id]);
	}

	async get(id: string) {
		const row = this.database
			.query<SessionRow, [string]>(
				"SELECT id, access_token, refresh_token, expires_at, email FROM bff_sessions WHERE id = ?",
			)
			.get(id);
		if (!row) return null;
		return {
			accessToken: decrypt(row.access_token, this.key),
			...(row.email ? { email: decrypt(row.email, this.key) } : {}),
			...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
			...(row.refresh_token
				? { refreshToken: decrypt(row.refresh_token, this.key) }
				: {}),
		};
	}

	async set(id: string, session: BffSession) {
		this.database.run(
			`INSERT INTO bff_sessions (id, access_token, refresh_token, expires_at, email)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			 access_token = excluded.access_token,
			 refresh_token = excluded.refresh_token,
			 expires_at = excluded.expires_at,
			 email = excluded.email`,
			[
				id,
				encrypt(session.accessToken, this.key),
				session.refreshToken ? encrypt(session.refreshToken, this.key) : null,
				session.expiresAt ?? null,
				session.email ? encrypt(session.email, this.key) : null,
			],
		);
	}

	private encryptExistingSessions() {
		const rows = this.database
			.query<SessionRow, []>(
				"SELECT id, access_token, refresh_token, expires_at, email FROM bff_sessions",
			)
			.all();
		for (const row of rows) {
			this.database.run(
				"UPDATE bff_sessions SET access_token = ?, refresh_token = ?, email = ? WHERE id = ?",
				[
					row.access_token.startsWith("v1:")
						? row.access_token
						: encrypt(row.access_token, this.key),
					row.refresh_token && !row.refresh_token.startsWith("v1:")
						? encrypt(row.refresh_token, this.key)
						: row.refresh_token,
					row.email && !row.email.startsWith("v1:")
						? encrypt(row.email, this.key)
						: row.email,
					row.id,
				],
			);
		}
	}
}
