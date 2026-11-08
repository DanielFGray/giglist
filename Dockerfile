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

# `services/chart-reader.ts` runs pdftotext and pdftoppm (poppler-utils) and
# tesseract with English data to read an uploaded chart; without them
# POST /api/charts/read fails with a server error.
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*

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
