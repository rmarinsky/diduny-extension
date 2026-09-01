import type { Database as BunDatabase } from "bun:sqlite";
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
	refresh_token: string | null;
};

export class SqliteSessionStore implements SessionStore {
	private readonly database: BunDatabase;

	constructor(path: string) {
		this.database = openBunDatabase(path);
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
				"SELECT access_token, refresh_token, expires_at, email FROM bff_sessions WHERE id = ?",
			)
			.get(id);
		if (!row) return null;
		return {
			accessToken: row.access_token,
			...(row.email ? { email: row.email } : {}),
			...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
			...(row.refresh_token ? { refreshToken: row.refresh_token } : {}),
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
				session.accessToken,
				session.refreshToken ?? null,
				session.expiresAt ?? null,
				session.email ?? null,
			],
		);
	}
}
