import { buildMockProxy } from "./src/mock-proxy";

const mock = await buildMockProxy();
await mock.server.listen({
	host: process.env.MOCK_PROXY_HOST ?? "0.0.0.0",
	port: Number(process.env.MOCK_PROXY_PORT ?? 3910),
});
