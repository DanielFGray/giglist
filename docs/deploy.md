# Deploy GigList

GigList runs on the homelab cluster that `~/build/server-ansible` manages, at
<https://giglist.dfg.rocks>. Traefik is the public edge, and it splits each request by path:

- `/api` goes to the `giglist-api` Nomad job, which `cartridge.json` declares. The same
  process runs the graphile-worker runner, and `/healthz` reports it.
- Every other path goes to the static-sites Caddy on atheist, which serves a release folder
  of `dist/`.

The two halves are released separately, so release both from the same commit. A page
build that is older or newer than the API can call endpoints that the API does not have.

Live setlist events stay in one API process's memory (`services/liveHub.ts`), so keep
`giglist-api` at one instance.

## Release the API

From this repository, with the commit to release at `HEAD`:

```sh
ops login            # once every 2 hours
ops secret check     # fails when a secret the cartridge names is unset
ops release          # builds HEAD, pushes the image, shows the plan, deploys
```

`ops release` builds from the committed `HEAD`, not the working tree. It pins the
image digest into a copy of `cartridge.json` and records the deployment on the control
host; `ops deployment list giglist` lists them and `ops rollback giglist <n>` deploys one
again. Configuration is in `cartridge.json`: plain values under `environment`, and
database, Valkey and OpenBao secrets under `secrets`. Set a new OpenBao key with
`ops secret set <key>`.

## Database migrations

Production applies only `migrations/committed/`. Commit the work in `migrations/current/`
with `bun run gm commit` before a release that needs it.

The cartridge's `migrate` task runs `bun run migrate` (`graphile-migrate migrate`) before
the API starts, on every deploy. It applies the committed migrations that production's
`graphile_migrate.migrations` table does not record yet. If it fails, the deploy fails and
Nomad keeps the previous version. `.gmrc.cjs` reads `DATABASE_OWNER`, `DATABASE_VISITOR`
and `DATABASE_AUTHENTICATOR` from the environment, so the task gets the migration login
as `DATABASE_URL` and the api login's name.

Production's migration record is built only by the migrate task, from the committed files.

Never run `db:init`, `db:setup`, `db:reset` or `db:latest` against production. They
drop databases, roles and schemas.

## Publish the pages

A page release is a folder under `/srv/www/giglist.dfg.rocks/` on atheist. It is never
changed after it is written. The router `giglist-dfg-rocks` in
`~/build/homelab-site/routes/sites.toml` names the live folder in `X-Site-Release`:

1. Build `dist/` with the `Containerfile`, whose image holds only `dist/`. Copy it to
   `/srv/www/giglist.dfg.rocks/<date>-<short commit>/` on atheist.
2. Set `X-Site-Release` to that folder in `routes/sites.toml`, and commit the site repository.
3. Run `ops rebuild atheist`.

To roll back, point `X-Site-Release` at the previous folder and rebuild. The route's
`X-Site-Fallback` sends the app page for a path that has no file, but only to a request
that accepts HTML. A missing script or image still gets 404.
`server-ansible/nixos/atheist/static-sites-operations.md` describes the file server.

## Security headers

Both halves send the same five headers: HSTS for one year, `nosniff`, a strict referrer
policy, a Permissions Policy that turns off camera, microphone, geolocation and payment, and
a Content Security Policy. The policy allows the app's scripts and same-origin API, inline
theme styles, HTTPS images, alphaTab's workers and sound fonts, and the YouTube, Spotify,
Vimeo, TikTok and Instagram player frames. It also limits parent frames to the same origin
and blocks plugins.

The API's copy is `responseHeaders` on its route in `cartridge.json`. The pages' copy is a
headers middleware on the site route. `script-src` names the hash of the inline script in
`index.html`, so a change to that script needs a new hash in both places.

## Email

The worker sends mail through `MAIL_PROVIDER`: `cloudflare` in production, `ses`, or
`development`. Development uses Nodemailer and Ethereal: it saves the account in
`worker/.ethereal` (or `ETHEREAL_ACCOUNT_FILE`) and logs a preview URL for each mail.

For Cloudflare, set `EMAIL_FROM` and `CLOUDFLARE_EMAIL_API_TOKEN`. Enable the sender's domain
for Email Sending and give the token `Email Sending: Edit`
([Cloudflare's SMTP setup](https://developers.cloudflare.com/email-service/get-started/send-emails/)).
For SES, the worker uses the AWS SDK credential chain and `AWS_REGION`.

`VITE_ROOT_URL` is the public origin in email links. The browser calls the API on its own
origin, so the page build needs no domain setting. `worker/worker.ts` provides the `Mailer`
layer once. A provider failure rejects the job, so Graphile Worker retries it. Run the
worker's tests with `bun run test:unit`.

## Rate limits

The API limits sign-up, login, email-sending and invitation endpoints by client address or
signed-in user, with counts in the shared Valkey (keys `giglist:rl:*`). Traefik sets
`X-Real-IP` to the client's address and replaces any value the client sent. The API's port
must therefore be reachable only through Traefik. If Valkey is down, sign-up and the
endpoints that send email refuse requests, and login keeps working.

## Backups

The cluster backs up every database: `restic-backups-postgres` on cynic writes a nightly
`pg_dumpall` to R2. `server-ansible/nixos/backup-operations.md` explains how to restore
giglist from it.

## Check a release

```sh
bun run check:production https://giglist.dfg.rocks
```

The check reads only. It probes the API as a signed-out visitor (`/api/auth/me`), the five headers, the page and
its script, alphaTab's files, and 404s for the testing API and missing assets. It changes
no account and sends no mail.

`GET /healthz` is the platform's health check (`healthCheck` in `cartridge.json`); Traefik routes
only `/api`, so the release check cannot reach it. It returns 200 `{status, commit}` only when
both database connections can run a query and the worker runs, and 503 with `failed` naming
`database` or `worker` after a failed query, a two-second timeout, or a stopped worker. `commit`
is the commit the deploy runs, which the platform sets as `GIT_COMMIT`, or `unknown` when it
is unset. The API sends traces and logs over OTLP to OpenObserve. Nothing alerts on a 503 or a failed job yet.
