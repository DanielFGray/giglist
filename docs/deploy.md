# Deploy GigList behind Caddy

Run one Bun API process and one Graphile Worker process. Caddy serves `dist/`
and forwards `/api` requests to Bun. Live setlist connections stay in one API
process, so keep the API process count at one.

## Prepare the host

1. Install Bun, Caddy, PostgreSQL 17 client tools, Poppler, and Tesseract with English data.
2. Install Bash, curl, and ripgrep for `check:production`.
3. Create the `giglist` service account and put the application in `/srv/giglist`.
4. Make Bun available in the service account's system `PATH`.
5. Give the Caddy account read access to `/srv/giglist/dist` and access through its parent directories.
6. Run `bun install --frozen-lockfile` in the application directory.
7. Run `bun run build`. The result includes the music fonts, sound fonts, and worker script in `dist/alphatab/`.

The service runs TypeScript with Bun. Keep `src/`, `generated/`, `node_modules/`,
`package.json`, and `worker/` in the release directory.

## Configure the environment

Create `/etc/giglist.env`, readable only by the service account and administrators.
Set these values for the production database and mail service:

```dotenv
DATABASE_URL=postgres://OWNER:PASSWORD@DATABASE_HOST:5432/DATABASE_NAME
AUTH_DATABASE_URL=postgres://AUTHENTICATOR:PASSWORD@DATABASE_HOST:5432/DATABASE_NAME
DATABASE_AUTHENTICATOR=YOUR_AUTHENTICATOR_ROLE
DATABASE_VISITOR=YOUR_VISITOR_ROLE
VALKEY_URL=redis://VALKEY_HOST:6379
VITE_ROOT_URL=https://YOUR_DOMAIN
EMAIL_FROM=GigList <YOUR_VERIFIED_SENDER_ADDRESS>
AWS_REGION=YOUR_SES_REGION
```

The API rate-limits sign-up, login, email-sending and invitation endpoints by
client address or signed-in user, and keeps the counts in Valkey (`VALKEY_URL`).
The Valkey instance may be shared with other apps: the keys all start with
`giglist:rl:`. The address comes from the `X-Real-IP` header that
`deploy/Caddyfile` sets, so the API must listen on loopback or a private network
that only Caddy can reach. If Valkey is down, sign-up and the endpoints that send
email refuse requests, and login keeps working.

The worker defaults to `MAIL_PROVIDER=ses` in production and
`MAIL_PROVIDER=development` in development. Set `MAIL_PROVIDER=cloudflare` to use
Cloudflare Email Sending through SMTP, the standard email submission protocol.
The same email jobs and templates work with each provider.

For SES, the worker uses the AWS SDK credential provider. Configure the host's AWS role
or supply `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. Temporary credentials
also need `AWS_SESSION_TOKEN`. Use a sender identity enabled for the SES account.

For Cloudflare, set `EMAIL_FROM` and `CLOUDFLARE_EMAIL_API_TOKEN`. Enable the
sender's domain for Email Sending and give the API token `Email Sending: Edit`
permission. `AWS_REGION` and AWS credentials are unnecessary for this provider.
Connection settings follow [Cloudflare's SMTP setup](https://developers.cloudflare.com/email-service/get-started/send-emails/).

The development provider uses Nodemailer and Ethereal. It saves account
credentials in `worker/.ethereal` and logs a preview URL after a successful send.
Set `ETHEREAL_ACCOUNT_FILE` to use another path. Tests inject their own `Mailer`
layer and use a local SMTP listener. Run them with `bun run test:mail`.
Starting the complete worker with `NODE_ENV=test` requires an explicit
`MAIL_PROVIDER`, so test mode does not select an external service by default.

`worker/main.ts` supplies the selected `Mailer` layer once and captures its
Effect context for Graphile callbacks. `sendEmail` declares `Mailer` in its
Requirements channel, the type parameter that lists the services an Effect needs.
Provider failures reject the callback, so Graphile can retry the job. Shutdown
stops the worker before it releases mail resources.

`VITE_ROOT_URL` is the public origin used in email links. The browser uses its
current origin for API requests, so the browser build needs no domain setting.

## Prepare the database release

The repository currently has no committed release migrations. Prepare and test
the first migration before the first deployment. Provision the owner,
authenticator, and visitor roles and the extensions in `migrations/afterReset.sql`.
The authenticator needs permission to set the visitor role.

**Do not run `db:init`, `db:setup`, `db:reset`, or `db:latest` against production.**
The setup script drops databases and roles. The current migration starts by
dropping all application schemas. These commands belong to development.

After a release migration exists, apply committed migrations with
`bun run gm migrate` before you start the services. Create the worker schema
with `bun run worker:schema` in that same production environment. Verify a
database backup and restore on a separate database before the first release.

## Start the services

1. Copy `deploy/giglist-api.service` and `deploy/giglist-worker.service` into `/etc/systemd/system/`.
2. Run `systemctl daemon-reload`.
3. Run `systemctl enable --now giglist-api giglist-worker`.
4. Read startup errors with `journalctl -u giglist-api -u giglist-worker`.

Both units set production mode and restart after a process failure. The API
listens on `127.0.0.1:3000`. To use another port, change the API unit and Caddy's
upstream together. Set `API_HOST` when Caddy runs on another host or network.

## Configure Caddy

Import `deploy/Caddyfile` into the host's Caddy configuration. Set `GIGLIST_SITE`
in the Caddy service environment to the public domain, without `https://`.
`GIGLIST_DIST` defaults to `/srv/giglist/dist` and `GIGLIST_API_UPSTREAM` defaults
to `127.0.0.1:3000`.

1. Run `caddy validate --config /etc/caddy/Caddyfile` in that environment.
2. Reload Caddy through the host's service manager.
3. Run `bun run check:production https://YOUR_DOMAIN`.

The routing follows [Caddy's documented single-page app pattern](https://caddyserver.com/docs/caddyfile/patterns#single-page-apps-spas).
API requests retain the `/api` prefix. Unknown API paths and missing music assets
return 404. Page links return the browser entry document, with revalidation on
each visit. Caddy flushes API responses immediately for live setlist events.

## Security headers

Caddy sends HSTS for one year, `nosniff`, a strict referrer policy, and a
Permissions Policy that disables camera, microphone, geolocation, and payment
access. Its enforced Content Security Policy allows the app's scripts and
same-origin API, inline theme styles, HTTPS images, alphaTab workers and sound
fonts, and the YouTube, Spotify, Vimeo, TikTok, and Instagram player frames.
The policy also limits parent frames to the same origin and blocks plugins.
Check the headers on `/login` and `/api/health` with
`bun run check:production https://YOUR_DOMAIN`.

`GET /api/health` returns 200 only when both database connections can run a query.
A failed query or a five-second timeout returns 503. Configure monitoring to
alert on that response and on failed worker jobs.

## Check a release

For a local check with the configured development database, run
`bun run check:production:local`. This builds the browser files and starts
temporary production API and Caddy processes on ports 3399 and 3499. It isolates
Caddy storage under `/tmp` and stops both processes after the check. Set
`CADDY_BIN` if Caddy is outside `PATH`. Use `PRODUCTION_CHECK_API_PORT` and
`PRODUCTION_CHECK_WEB_PORT` to select other ports.

The production check verifies public page delivery, JavaScript and sound font
delivery, database connectivity, and exclusion of testing endpoints. It makes no
account changes and sends no email.

Before opening the service to users, also verify signup, email verification,
password reset, uploads, access between bands, and live updates through HTTPS.
Mail delivery and certificate issuance require the real host configuration.
