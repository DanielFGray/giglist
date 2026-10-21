# Builds setlist's client. The output is an image whose only contents are dist/,
# so one `podman cp` from it gives the static files Caddy serves.
FROM localhost/bun-base:1 AS build
WORKDIR /src
COPY . .
# Lifecycle scripts are skipped: the `prepare` script patches TypeScript for editors,
# and a build does not need it. Skipping them also leaves out the `vite` bin link,
# so the client build runs vite's entry point directly. `client:build` is `vite build`.
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun node_modules/vite/bin/vite.js build

FROM scratch
COPY --from=build /src/dist /dist
