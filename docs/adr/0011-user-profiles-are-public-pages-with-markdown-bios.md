---
status: proposed
---

# User profiles are public pages, off until the user turns them on

A user has a public profile at `/u/:username` only while they keep `users.is_public` on (off by default; the "Public profile" switch on the settings page). It shows their name, picture, **bio**, and the bands they belong to whose own pages are on, each linking to `/b/:slug`.

## What is stored

One column on `users`:

- `is_public` says the profile is on. `bio` stays a text column; its length limit rises from 4 000 to 10 000, matching a band's description, so Markdown with links and pasted embed code fits.

The users table is publicly readable under RLS by design, but the page does not trust that: like the band page (docs/adr/0006), it reads only through the security-definer functions `public_user(username)` and `public_user_bands(username)`. Both return no rows while the profile is off, and `public_user_bands` also returns none for a band whose page is off. The functions return exactly the public fields — never an email, role or session-adjacent column.

## The bio

The bio is Markdown, rendered by the same `renderDescription` as a band's description (docs/adr/0010): links, pictures, and a YouTube, Spotify, Vimeo, TikTok or Instagram link standing alone becomes that provider's player. The settings page shows a live preview as the user types.

Unlike a band page, a profile is drawn by the app (`Markdown.tsx` in a normal page), not by a band-written theme in a sandboxed frame. That is safe because the renderer escapes every tag the author typed: the only markup in the output is the renderer's own, and each player is a cross-origin document in its own sandboxed frame. No theme sanitiser is needed here.

(Superseded in part by docs/adr/0012: a profile is now a theme the user writes, shown in the same sandboxed frame as a band page.)

## Consequences

- A username is findable only when its owner turns the profile on; an unknown name and a switched-off profile answer the same 404.
- Turning the profile off keeps the bio, so turning it on again brings the same page back.
- A member's bio is not shown on band pages: a band owner showing the member list does not publish each member's bio. A bio is public only on its author's own profile.
