import { afterAll, beforeAll, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../server";
import { SqliteSessionStore } from "../src/server/session-store";
import { invalidEmails, projectEmails, validEmails } from "./fixtures/emails";

const databasePath = join(
	tmpdir(),
	`diduny-email-encoding-${crypto.randomUUID()}.db`,
);
const upstreamRequests = [];
let sendOtpStatus = 204;
let verifyOtpStatus = 200;
let echoUser = true;
let server;
let sessions;

beforeAll(async () => {
	sessions = new SqliteSessionStore(databasePath, "test-session-secret");
	server = await buildServer({
		fetch: async (url, init) => {
			const body = JSON.parse(String(init?.body));
			upstreamRequests.push({ body, rawBody: init?.body, url: String(url) });
			if (String(url).endsWith("/auth/send-otp"))
				return new Response(null, { status: sendOtpStatus });
			if (String(url).endsWith("/auth/verify-otp")) {
				if (verifyOtpStatus !== 200)
					return Response.json(
						{ error: "invalid_otp" },
						{ status: verifyOtpStatus },
					);
				return Response.json({
					accessToken: "backend-bearer-token",
					accessTokenExpiresAt: Date.now() + 120_000,
					refreshToken: "server-refresh-token",
					...(echoUser ? { user: { email: body.email } } : {}),
				});
			}
			throw new Error(`Unexpected upstream path ${url}`);
		},
		sessions,
		upstreamUrl: "http://upstream.test",
	});
});

afterAll(async () => {
	await server.close();
	sessions.close();
	await rm(databasePath, { force: true });
});

let clientCount = 0;

// Auth routes are rate-limited per IP; give every request its own client address.
function inject(options) {
	clientCount += 1;
	return server.inject({
		...options,
		remoteAddress: `10.0.${clientCount >> 8}.${clientCount & 255}`,
	});
}

async function signIn(email) {
	const sent = await inject({
		method: "POST",
		payload: { email },
		url: "/bff/auth/send-otp",
	});
	const verified = await inject({
		method: "POST",
		payload: { email, otp: "123456" },
		url: "/bff/auth/verify-otp",
	});
	const profile = await inject({
		headers: { cookie: verified.headers["set-cookie"][0] },
		method: "GET",
		url: "/bff/auth/session",
	});
	return { profile, sent, verified };
}

test.each([...validEmails, ...projectEmails])(
	"forwards and stores %s byte-for-byte",
	async (email) => {
		upstreamRequests.length = 0;
		echoUser = true;
		const { profile, sent, verified } = await signIn(email);

		expect(sent.statusCode).toBe(204);
		expect(verified.statusCode).toBe(200);
		expect(upstreamRequests.map((request) => request.body.email)).toEqual([
			email,
			email,
		]);
		expect(upstreamRequests[0].rawBody).toBe(JSON.stringify({ email }));
		expect(verified.json()).toEqual({ email });
		expect(profile.json()).toEqual({ authenticated: true, email });
	},
);

test("keeps the submitted address when upstream omits the user", async () => {
	echoUser = false;
	const email = "I❤️CHOCOLATE🍫@example.com";
	const { profile } = await signIn(email);
	expect(profile.json()).toEqual({ authenticated: true, email });
	echoUser = true;
});

test.each(invalidEmails)(
	"rejects %s without contacting upstream",
	async (email) => {
		upstreamRequests.length = 0;
		const sent = await inject({
			method: "POST",
			payload: { email },
			url: "/bff/auth/send-otp",
		});
		const verified = await inject({
			method: "POST",
			payload: { email, otp: "123456" },
			url: "/bff/auth/verify-otp",
		});

		expect(sent.statusCode).toBe(400);
		expect(sent.json()).toEqual({ error: "invalid_email" });
		expect(verified.statusCode).toBe(400);
		expect(upstreamRequests).toEqual([]);
	},
);

test.each([
	[400, 400, "invalid_email"],
	[422, 400, "invalid_email"],
	[429, 502, "upstream_auth_unavailable"],
	[500, 502, "upstream_auth_unavailable"],
])(
	"maps an upstream %i on send-otp to %i %s",
	async (upstreamStatus, status, error) => {
		sendOtpStatus = upstreamStatus;
		const sent = await inject({
			method: "POST",
			payload: { email: "simple@project.com" },
			url: "/bff/auth/send-otp",
		});
		sendOtpStatus = 204;

		expect(sent.statusCode).toBe(status);
		expect(sent.json()).toEqual({ error });
	},
);

test.each([
	[400, 401, "otp_verification_failed"],
	[401, 401, "otp_verification_failed"],
	[422, 401, "otp_verification_failed"],
	[429, 502, "upstream_auth_unavailable"],
	[500, 502, "upstream_auth_unavailable"],
])(
	"maps an upstream %i on verify-otp to %i %s",
	async (upstreamStatus, status, error) => {
		verifyOtpStatus = upstreamStatus;
		const verified = await inject({
			method: "POST",
			payload: { email: "simple@project.com", otp: "654321" },
			url: "/bff/auth/verify-otp",
		});
		verifyOtpStatus = 200;

		expect(verified.statusCode).toBe(status);
		expect(verified.json()).toEqual({ error });
		expect(verified.headers["set-cookie"]).toBeUndefined();
	},
);
