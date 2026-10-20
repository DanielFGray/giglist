---
status: proposed
---

# User profiles are themes the user writes, with no starter themes

A user's public profile (docs/adr/0011) looks the way the user's **theme** says, like a band's page (docs/adr/0006). One difference is deliberate: profiles have **no starter themes**. Bands get Classic, Gig poster and Zine to start from; a profile offers only the built-in default and the user's own HTML. A profile is a smaller, more personal page, and the default already shows everything — the user who wants a look writes it, and "Restore default theme" in the account settings is the way back.

## What is stored

Two columns on `users`, mirroring the band columns:

- `page_theme` holds the theme source, at most 200 000 characters. Null means the built-in default theme (`user-theme.html`).
- `page_options` holds the user's values for the options the theme declares, as a JSON object keyed like `color:Accent`.

`public_user(username)` returns both with the rest of the profile. The database checks only size and shape; it never reads the HTML.

## The tags

`renderTheme` fills the tags in, with `userScope` in `src/components/band-theme.ts` making the data — the same engine and tag language as band themes, so a user who has themed a band already knows it. `{DisplayName}`, `{Username}`, `{Initial}`, `{AvatarURL}`, `{Bio}` (the Markdown source) and `{BioHTML}` (rendered, players included), `<block:Band>` per public band with `{BandName}`, `{BandSlug}`, `{BandURL}`, plus `<block:NameWord>`/`<block:NameLetter>`, `<block:NotName>`, and `<meta name="kind:Name">` theme options read with `{color:Accent}` and friends.

## Isolation

The profile is the `srcdoc` of the same sandboxed frame as a band page, with the same treatment (docs/adr/0010): scripts allowed only for the bio's provider players, `theme-sanitize.ts` strips the theme's own code first, and no same-origin access or forms. The account settings show a live preview in that frame while the user edits.

This replaces the app-drawn profile of docs/adr/0011: the page is the user's document now, not the app's layout.

## Consequences

- The default theme is the only built-in. Later changes to it reach only users who never saved a theme of their own; a user who edited keeps their copy, and Restore brings the current default back.
- A theme that prints neither `{BioHTML}` nor the band list simply does not show them; the settings preview is where the user finds out.
