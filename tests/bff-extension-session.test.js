import { expect, test } from "bun:test";
import { buildServer, defaultExtensionOrigin } from "../server";

test("scopes the cross-site extension cookie to BFF extension routes", async () => {
	const server = await buildServer({
		fetch: async (url) => {
			if (String(url).endsWith("/auth/verify-otp")) {
				return Response.json({
					accessToken: "server-only-token",
					accessTokenExpiresAt: Date.now() + 300_000,
					refreshToken: "server-only-refresh",
					user: { email: "person@example.com" },
				});
			}
			if (String(url).endsWith("/usage/me"))
				return Response.json({ remaining_seconds: 60 });
			throw new Error(`Unexpected upstream request: ${url}`);
		},
		upstreamUrl: "http://upstream.test",
	});

	const verified = await server.inject({
		method: "POST",
		payload: { email: "person@example.com", otp: "123456" },
		url: "/bff/auth/verify-otp",
	});
	const cookies = verified.headers["set-cookie"];
	const extensionCookie = cookies.find((cookie) =>
		cookie.startsWith("diduny_extension_session="),
	);

	expect(cookies[0]).toContain("SameSite=Lax");
	expect(extensionCookie).toContain("HttpOnly");
	expect(extensionCookie).toContain("Secure");
	expect(extensionCookie).toContain("SameSite=None");
	expect(extensionCookie).toContain("Path=/bff/extension/");

	const accepted = await server.inject({
		headers: {
			cookie: extensionCookie,
			origin: defaultExtensionOrigin,
		},
		method: "GET",
		url: "/bff/extension/api/usage/me",
	});
	const rejected = await server.inject({
		headers: {
			cookie: extensionCookie,
			origin: "chrome-extension://untrusted-extension-id",
		},
		method: "GET",
		url: "/bff/extension/api/usage/me",
	});

	expect(accepted.statusCode).toBe(200);
	expect(rejected.statusCode).toBe(403);
	await server.close();
});
