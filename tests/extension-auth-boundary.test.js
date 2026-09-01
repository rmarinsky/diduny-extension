import { expect, test } from "bun:test";

const extensionSources = [
	"entrypoints/background.ts",
	"entrypoints/sidepanel/hooks/useAuth.ts",
	"entrypoints/sidepanel/components/AuthScreen.tsx",
];

test("extension delegates sign-in to the first-party BFF page", async () => {
	const contents = await Promise.all(
		extensionSources.map((path) => Bun.file(path).text()),
	);
	const source = contents.join("\n");

	expect(source).not.toContain("sendBffOtp");
	expect(source).not.toContain("verifyBffOtp");
	expect(source).not.toContain("signInRequest");
	expect(source).not.toContain("verifyOtpRequest");
	expect(source).toContain("openBffSignIn");
});
