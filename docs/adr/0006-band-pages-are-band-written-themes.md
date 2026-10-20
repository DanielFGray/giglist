---
status: proposed
---

# Band pages are themes the band writes, shown in a sandboxed frame

A band's public page at `/b/:slug` looks the way the band's **theme** says. A theme is one HTML document the band can edit, with **theme tags** in the style of Tumblr themes. The band does not pick from a fixed set of layouts. Three **starter themes** (Classic, Gig poster, Zine) are only text to copy and change.

## What is stored

Two columns on `bands`:

- `page_theme` holds the theme source, at most 200 000 characters. Null means the built-in Classic theme.
- `page_options` holds the band's values for the **theme options** the theme declares, as a JSON object keyed like `color:Accent`.

`public_band(slug)` returns both. The database checks only size and shape. It never reads or runs the HTML.

## The tags

`renderTheme` in `src/components/band-theme.ts` fills in the tags; `bandScope` makes the data.

- `{Name}` prints a value, HTML-escaped. Values are the band's name and description, and per row the gig, member and song fields.
- `<block:Name>…</block:Name>` repeats once per row when Name is a list (Gig, Member, Song, NameWord, NameLetter). It shows once when Name is a non-empty text or a true flag (Gigs, Members, Songs, Owner). `<block:NotName>` shows when Name is empty.
- `<meta name="kind:Name" content="default">` declares a theme option. The band settings show one field per option. Kinds are `color`, `image` (an http or https link to a picture the band hosts), `text` and `if`. `{color:Accent}` prints the value. An `if` option opens `<block:IfName>` and `<block:IfNotName>`, and an image option that is set opens `<block:IfNameImage>`.
- A tag that names nothing stays as written, so CSS braces need no escaping. A stray closing tag or an unclosed block stays visible as text, and the rest of the page still renders.
- Blocks were first spelled Tumblr-style, `{block:Name}…{/block:Name}`. The tag spelling replaced it — so the document's structure is one markup language — and the curly block spelling is no longer read: a theme still using it shows those tags as text and needs them rewritten as `<block:Name>`. Values and options stay curly — `{BandName}`, `{color:Accent}` — because, as in JSX, they are substitutions in text and attributes, not structure.

Colors and image links print without escaping, so they can go in CSS and in attributes. A value is used only when it matches its kind: `#rrggbb` for a color, or an http(s) link with no spaces, quotes, angle brackets or parentheses for an image. Any other value falls back to the theme's default. Text values print escaped.

## Isolation

The filled-in document is the `srcdoc` of an iframe with `sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"`. Without `allow-scripts`, `allow-forms` or `allow-same-origin`, a theme cannot run code, read the visitor's GigList session or cookies, or show a working login form. It can load stylesheets, fonts and images from anywhere, and its links can open a new tab or, on a click, replace the window.

(Amended by docs/adr/0010: the frame now allows scripts so Markdown descriptions can show provider players, and the theme's own code is stripped before the document reaches the frame; the no-session-access and no-forms promises above stand.)

So the theme language does not need to make HTML safe. It needs only to keep the band's data from changing the theme's structure, which escaping does.

A theme can load anything by URL, so the people who open a band page reveal their IP address to the hosts that theme names. This is the same as an image in an email.

## Consequences

- A member's picture is a Gravatar link that answers 404 when the user has none. A theme cannot catch that with a script, so the starters use `<object data="{AvatarURL}">{MemberInitial}</object>`, which shows its content when the picture fails.
- A band that picked a starter keeps its copy. Later changes to a starter do not reach it, and the editor asks before a starter replaces a theme that matches no current starter.
- Pictures are links, not uploads. Image upload is a separate feature.
- A theme with an error still renders. The band sees the result in the live preview beside the editor.
