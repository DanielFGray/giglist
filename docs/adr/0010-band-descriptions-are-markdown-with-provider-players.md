---
status: proposed
---

# Band descriptions are Markdown, with provider links shown as players

A band's public **description** (the `description` column, ADR 0006) is written as Markdown. A theme prints it rendered with `{DescriptionHTML}`; `{Description}` still prints the Markdown source, escaped, for themes that want the text itself. The starter themes print `{DescriptionHTML}`.

## Rendering

`renderDescription` in `src/components/description.ts` renders with markdown-it (CommonMark), with raw HTML disabled: HTML the band types shows as text, so the only markup in the output is the markup the renderer makes. Links open in a new tab, images load lazily, and markdown-it refuses non-web link schemes.

A link to YouTube, Spotify, Vimeo, TikTok or Instagram that stands alone in its own paragraph — bare, or as `[text](link)` — becomes that provider's player: a sandboxed iframe on the provider's embed host, built from the validated post id in `embedForUrl`. The same link inside a sentence stays a link. Short links that cannot be read without asking the provider (such as `vm.tiktok.com`) stay links. Pasting a provider's embed code also works: an iframe, or TikTok's and Instagram's blockquote, is read for the post's link and replaced by the same player.

## What this changes about the sandbox

ADR 0006 showed the themed page in a frame without `allow-scripts`, so a theme could not run code. Chromium inherits a frame's sandbox into nested frames (verified in Chromium 140), so under that sandbox a YouTube player inside the page fails with "Unable to execute JavaScript": playable players and a wholly scriptless frame cannot both be had in one document.

The frame now allows scripts, and two things keep the ADR 0006 promise:

- The sandbox still leaves out `allow-same-origin` and `allow-forms`, so nothing in the frame can read the visitor's GigList session or submit a form.
- `sanitizeThemeHtml` in `src/components/theme-sanitize.ts` strips the theme's own code before the document reaches the frame: scripts (with their contents), event handlers, `srcdoc`, script-scheme links, refresh/policy meta tags, and every iframe. An iframe whose source is a known provider's player survives, rebuilt by `embedHtml` with our sandbox and attributes. The players are cross-origin documents, each in its own frame with `allow-scripts allow-same-origin` (their players need it), so provider code runs at the provider, not in the band page.

So a theme still cannot run code; only the five providers' players can, in their own frames. A theme can already load stylesheets, fonts and images from anywhere, so the people who open a band page still reveal their IP address to the hosts the page names — now including a provider when a description embeds its player.

## Consequences

- An old theme that prints `{Description}` shows the Markdown source, markers and all; printing `{DescriptionHTML}` is the fix, and the theme-tag reference in the band settings says so.
- Themes style the rendered description under `.description` (paragraphs, links, lists, `.embed` players); the starters do.
- Embeds are recognised by host and post id in one place (`embedForUrl`); adding a provider is adding one branch there and one player sandbox that already fits.
