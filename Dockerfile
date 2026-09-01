FROM oven/bun:1.3.10 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build:web

FROM oven/bun:1.3.10

WORKDIR /app

ENV DATA_DIR=/data \
	HOST=0.0.0.0 \
	NODE_ENV=production \
	PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/server-main.ts ./server-main.ts
COPY --from=build /app/mock-proxy-main.ts ./mock-proxy-main.ts
COPY --from=build /app/src ./src
COPY --from=build /app/web/dist ./web/dist

VOLUME ["/data"]
EXPOSE 3000

CMD ["bun", "run", "start:web"]
