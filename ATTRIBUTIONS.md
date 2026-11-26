# Attributions

This file lists every outside source GigList uses: code we adapted, data we fitted to, assets we serve, research the code follows, and libraries whose license asks more than MIT does.

The chart code (`gigbag.js/charts/*`) moved to the kit. Its sources are listed in the kit's `ATTRIBUTIONS.md`, including the GPL-2.0 condition that ChordSheetJS puts on any client bundle that includes a chart module.

When a change brings in a source, add its entry in the same commit, with a link. The code comment that uses the source names it, so a reader can find the entry here.

The build writes the license text of every npm package in the client bundle to `/third-party-licenses.txt` (`scripts/licenseNoticesPlugin.ts`), so this file does not repeat them.

## Code adapted

- **postgres.garden**: production-only exclusion of testing handlers in `src/server/main.ts` follows `../postgres.garden/server/index.ts`.

- **graphile-starter**: the user, session, email and organization migrations in `migrations/`, the three-schema layout, and the email jobs and templates in `worker/` follow it. MIT License, Copyright © 2020 Graphile Ltd. <https://github.com/graphile/starter>. License text: <https://github.com/graphile/starter/blob/main/GRAPHILE_STARTER_LICENSE.md>

## Services

- **Cloudflare Email Service**: the Cloudflare `Mailer` layer in `worker/email/mailer.ts` follows its authenticated SMTP submission settings. <https://developers.cloudflare.com/email-service/get-started/send-emails/>

- **Gravatar**: a new account's default `avatar_url` is the Gravatar image for its signup email, addressed by the SHA-256 hash of the trimmed, lowercased email per the Gravatar image API (`src/server/gravatar.ts`). <https://docs.gravatar.com/api/avatars/images/>

## Fonts

- **Bravura** by Steinberg Media Technologies: the music font that alphaTab serves, and that `src/components/ChordStaff.tsx` draws staff glyphs with. SIL Open Font License 1.1. <https://github.com/steinbergmedia/bravura>. Glyph names follow SMuFL: <https://w3c.github.io/smufl/latest/>
- **DM Sans** and **JetBrains Mono**: loaded from Google Fonts. SIL Open Font License 1.1. <https://fonts.google.com/specimen/DM+Sans>, <https://fonts.google.com/specimen/JetBrains+Mono>

## Research

- **OWASP Bot Management and Anti-Automation Cheat Sheet**: the feedback form's spam trap follows the cheat sheet's hidden-field honeypot — a plainly named field (`website`) that sits off the page, is never tabbed to, and is refused server-side when filled (`src/api/feedback.ts`, `src/components/FeedbackDialog.tsx`). <https://cheatsheetseries.owasp.org/cheatsheets/Bot_Management_and_Anti-Automation_Cheat_Sheet.html>

## Libraries with conditions beyond MIT

- **AWS SDK for JavaScript**: `@aws-sdk/client-sesv2` sends production email through Amazon SES. Apache-2.0. <https://github.com/aws/aws-sdk-js-v3>

- **ChordSheetJS**: reaches GigList through the kit's chart modules (`gigbag.js/charts/lyrics` and the modules that import it), so it is in the client bundle. GPL-2.0-only. The kit's `ATTRIBUTIONS.md` states the condition. <https://github.com/martijnversluis/ChordSheetJS>
- **alphaTab**: draws and plays scores and phrases. MPL-2.0. <https://alphatab.net>
- **diff-match-patch**: reaches GigList through the kit's `gigbag.js/charts/marks`, which maps a player's marks through later chart revisions (`follow.ts` in the kit). Apache-2.0. <https://github.com/JackuB/diff-match-patch>
- **markdown-it**: renders a band's Markdown description to HTML (`src/components/description.ts`). MIT License. <https://github.com/markdown-it/markdown-it>
- **htmlparser2**: tokenises a filled-in band theme so the band's own scripts and frames can be stripped before the page is shown (`src/components/theme-sanitize.ts`). MIT License. <https://github.com/fb55/htmlparser2>

Every other runtime dependency in `package.json` uses the MIT or MIT-0 license.

## Test material

- **Nodemailer SMTP Server**: `smtp-server` provides the local SMTP listener used to verify delivery and recipient rejection in `worker/email/emailDelivery.test.ts`. MIT-0 License. <https://github.com/nodemailer/smtp-server>

- **"Amazing Grace"**: words by John Newton (1779), in the public domain. Used in `tests/fixtures/amazing-grace.*`.
