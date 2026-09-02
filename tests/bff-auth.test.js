import { expect, test } from "bun:test";
import { buildServer } from "../server";

test("owns OTP verification server-side and exposes only an opaque secure BFF session", async () => {
	const upstreamRequests = [];
	const server = await buildServer({
		fetch: async (url, init) => {
			upstreamRequests.push({ body: init?.body, url: String(url) });
			if (String(url).endsWith("/auth/send-otp")) return Response.json({});
			if (String(url).endsWith("/auth/verify-otp")) {
				return Response.json({
					accessToken: "backend-bearer-token",
					accessTokenExpiresAt: Date.now() + 120_000,
					refreshToken: "server-refresh-token",
					user: { email: "person@example.com" },
				});
			}
			if (String(url).endsWith("/usage/me")) {
				expect(init?.headers).toEqual({
					authorization: "Bearer backend-bearer-token",
				});
				return Response.json({ isWhitelisted: true, usedHours: 0, usedMs: 0 });
			}
			throw new Error(`Unexpected upstream path ${url}`);
		},
		upstreamUrl: "http://upstream.test",
	});

	const sent = await server.inject({
		method: "POST",
		payload: { email: "person@example.com" },
		url: "/bff/auth/send-otp",
	});
	expect(sent.statusCode).toBe(204);

	const verified = await server.inject({
		method: "POST",
		payload: { email: "person@example.com", otp: "123456" },
		url: "/bff/auth/verify-otp",
	});
	const cookie = verified.headers["set-cookie"][0];

	expect(verified.statusCode).toBe(200);
	expect(verified.json()).toEqual({ email: "person@example.com" });
	expect(JSON.stringify(verified.json())).not.toContain("token");
	expect(cookie).toContain("HttpOnly");
	expect(cookie).toContain("Secure");
	expect(cookie).toContain("SameSite=Lax");

	const profile = await server.inject({
		headers: { cookie },
		method: "GET",
		url: "/bff/auth/session",
	});
	const relayed = await server.inject({
		headers: { cookie },
		method: "GET",
		url: "/bff/api/usage/me",
	});

	expect(profile.json()).toEqual({
		authenticated: true,
		email: "person@example.com",
	});
	expect(relayed.statusCode).toBe(200);
	expect(upstreamRequests.map((request) => request.url)).toEqual([
		"http://upstream.test/api/v1/auth/send-otp",
		"http://upstream.test/api/v1/auth/verify-otp",
		"http://upstream.test/api/v1/usage/me",
	]);

	await server.close();
});

test("clears a local session even when upstream logout fails", async () => {
	const server = await buildServer({
		fetch: async (url) => {
			if (String(url).endsWith("/auth/verify-otp")) {
				return Response.json({
					accessToken: "backend-bearer-token",
					accessTokenExpiresAt: 120_000,
					refreshToken: "server-refresh-token",
				});
			}
			throw new Error("upstream is down");
		},
		upstreamUrl: "http://upstream.test",
	});
	const verified = await server.inject({
		method: "POST",
		payload: { email: "person@example.com", otp: "123456" },
		url: "/bff/auth/verify-otp",
	});
	const cookie = verified.headers["set-cookie"];

	const loggedOut = await server.inject({
		headers: { cookie },
		method: "POST",
		url: "/bff/auth/logout",
	});
	const profile = await server.inject({
		headers: { cookie },
		method: "GET",
		url: "/bff/auth/session",
	});

	expect(loggedOut.statusCode).toBe(204);
	expect(loggedOut.headers["set-cookie"][0]).toContain("Max-Age=0");
	expect(profile.json()).toEqual({ authenticated: false });

	await server.close();
});
