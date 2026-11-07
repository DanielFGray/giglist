# Stage 1: install dependencies and build the browser assets
FROM oven/bun:1.4.4 AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY patches ./patches
RUN bun install --frozen-lockfile

COPY . .
RUN bun run client:build

# Stage 2: production runtime. The API runs from source with Bun, as in `bun run start`.
FROM oven/bun:1.4.4 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ARG GIT_COMMIT
ENV GIT_COMMIT=$GIT_COMMIT

COPY package.json bun.lock ./
COPY patches ./patches
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY src ./src
COPY generated ./generated
COPY worker ./worker
COPY migrations ./migrations
COPY .gmrc ./

# The browser assets, for the static host that serves dist/
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["bun", "run", "start"]
