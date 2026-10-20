import MarkdownIt from "markdown-it"

/**
 * Public prose — a band's description, a user's bio — written as Markdown
 * (docs/adr/0010).
 *
 * Borrowed: rendered with markdown-it <https://github.com/markdown-it/markdown-it>,
 * a CommonMark parser; see ATTRIBUTIONS.md. `html: false` means HTML the band
 * types is shown as text, never run, so the only markup in the output is the
 * markup made here: links (http/https/mail only, checked by markdown-it),
 * images, and the provider players below.
 *
 * A link to YouTube, Spotify, Vimeo, TikTok or Instagram standing alone in
 * its own paragraph — a bare link, or `[text](link)` — becomes that
 * provider's player. The same link inside a sentence stays a link. Pasting a
 * provider's embed code works too: its iframe (or TikTok/Instagram
 * blockquote) is read for the post's link and replaced by the same player.
 */

export type EmbedProvider = "youtube" | "spotify" | "vimeo" | "tiktok" | "instagram"

export type Embed = {
  provider: EmbedProvider
  /** The player's own URL, built only from the validated id below. */
  src: string
  title: string
  /** Set for players that are not 16:9 (Spotify); the theme sizes the rest by provider class. */
  height?: number
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtube-nocookie.com", "youtube-nocookie.com"])
const ID = /^[A-Za-z0-9_-]{4,64}$/

/** The player for a link, or null when the link is not a playable post on a known provider. */
export function embedForUrl(raw: string): Embed | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  const host = url.hostname.toLowerCase()
  const parts = url.pathname.split("/").filter((p) => p !== "")

  if (YOUTUBE_HOSTS.has(host)) {
    const id =
      host === "youtu.be"
        ? parts[0]
        : parts[0] === "watch"
          ? url.searchParams.get("v") ?? undefined
          : ["shorts", "embed", "live", "v"].includes(parts[0] ?? "")
            ? parts[1]
            : undefined
    if (id !== undefined && ID.test(id)) {
      return { provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${id}`, title: "YouTube video player" }
    }
    return null
  }

  if (host === "open.spotify.com") {
    const rest = parts[0] === "embed" ? parts.slice(1) : parts[0]?.startsWith("intl-") ? parts.slice(1) : parts
    const [type, id] = rest
    if ((type === "track" || type === "album" || type === "playlist" || type === "episode" || type === "show" || type === "artist") && id !== undefined && ID.test(id)) {
      const tall = type === "album" || type === "playlist" || type === "show" || type === "artist"
      return { provider: "spotify", src: `https://open.spotify.com/embed/${type}/${id}`, title: "Spotify player", height: tall ? 352 : 152 }
    }
    return null
  }

  if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
    const id = host === "player.vimeo.com" ? (parts[0] === "video" ? parts[1] : undefined) : parts.find((p) => /^\d+$/.test(p))
    if (id !== undefined && /^\d{5,}$/.test(id)) {
      return { provider: "vimeo", src: `https://player.vimeo.com/video/${id}`, title: "Vimeo video player" }
    }
    return null
  }

  if (host === "tiktok.com" || host === "www.tiktok.com") {
    const id = parts[0] === "embed" ? parts[2] ?? parts[1] : parts[0]?.startsWith("@") && parts[1] === "video" ? parts[2] : undefined
    if (id !== undefined && /^\d{5,}$/.test(id)) {
      return { provider: "tiktok", src: `https://www.tiktok.com/embed/v2/${id}`, title: "TikTok video player" }
    }
    return null
  }

  if (host === "instagram.com" || host === "www.instagram.com") {
    const [kind, code] = parts[0] === "embed" ? parts.slice(1) : parts
    if ((kind === "p" || kind === "reel" || kind === "reels" || kind === "tv") && code !== undefined && ID.test(code)) {
      const path = kind === "reels" ? "reel" : kind
      return { provider: "instagram", src: `https://www.instagram.com/${path}/${code}/embed`, title: "Instagram post player" }
    }
    return null
  }

  return null
}

/** Our player markup; the theme iframe keeps these and drops every other iframe (`theme-sanitize.ts`). */
export function embedHtml(embed: Embed): string {
  const height = embed.height === undefined ? "" : ` height="${embed.height}"`
  return `<div class="embed embed-${embed.provider}"><iframe class="embed-player" src="${embed.src}" title="${embed.title}"${height} loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
}

const md = new MarkdownIt({ html: false, linkify: true })

// Links leave the band page in a new tab; the page itself stays behind them.
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx]!
  const href = String(token.attrGet("href") ?? "")
  if (/^https?:\/\//i.test(href)) {
    token.attrSet("target", "_blank")
    token.attrSet("rel", "noopener noreferrer")
  }
  return self.renderToken(tokens, idx, options)
}

// markdown-it prints an image's alt from its children, which renderToken
// alone would lose; set it (and lazy loading) first, then render the token.
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!
  token.attrSet("alt", self.renderInlineAsText(token.children ?? [], options, env))
  token.attrSet("loading", "lazy")
  return self.renderToken(tokens, idx, options)
}

/**
 * Provider embed code pasted as-is, replaced by the post's plain link so the
 * paragraph below turns it into our player. An iframe for anywhere else is
 * dropped: its code would otherwise show as text.
 */
function pastedEmbeds(source: string): string {
  const fromIframe = source.replace(/<iframe\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>(?:\s*<\/iframe>)?/gi, (_tag, dq: string | undefined, sq: string | undefined) => {
    const src = dq ?? sq ?? ""
    return embedForUrl(src) ? `\n\n${src}\n\n` : "\n\n"
  })
  // TikTok and Instagram hand out a blockquote plus a script; the blockquote
  // names the post (`cite`, `data-instgrm-permalink`, or a link inside it).
  return fromIframe.replace(/<blockquote\b[^>]*(?:tiktok-embed|instagram-media)[^>]*>[\s\S]*?<\/blockquote>\s*(?:<script\b[^>]*>[\s\S]*?<\/script>)?/gi, (block) => {
    const named = /\b(?:cite|data-instgrm-permalink|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    for (const match of block.matchAll(named)) {
      const url = match[1] ?? match[2] ?? ""
      if (embedForUrl(url)) return `\n\n${url}\n\n`
    }
    return "\n\n"
  })
}

type Token = ReturnType<typeof md.parse>[number]

/** The embed a paragraph stands for, when the paragraph is nothing but one link to a playable post. */
function paragraphEmbed(inline: Token): Embed | null {
  const children = (inline.children ?? []).filter((c) => !(c.type === "text" && c.content.trim() === ""))
  if (children.length < 3 || children[0]!.type !== "link_open" || children.at(-1)!.type !== "link_close") return null
  if (!children.slice(1, -1).every((c) => c.type === "text" || c.type === "code_inline")) return null
  return embedForUrl(String(children[0]!.attrGet("href") ?? ""))
}

/** Renders Markdown prose to HTML: a theme prints it with `{DescriptionHTML}`, and `Markdown.tsx` prints it on a user profile. */
export function renderDescription(source: string): string {
  const tokens = md.parse(pastedEmbeds(source), {})
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i]!.type !== "paragraph_open" || tokens[i + 1]!.type !== "inline" || tokens[i + 2]!.type !== "paragraph_close") continue
    const embed = paragraphEmbed(tokens[i + 1]!)
    if (embed) {
      // Reuse the paragraph's token as a raw block: the renderer prints its content as-is.
      const block = tokens[i]!
      block.type = "html_block"
      block.tag = ""
      block.content = `${embedHtml(embed)}\n`
      block.children = null
      tokens.splice(i + 1, 2)
    }
  }
  return md.renderer.render(tokens, md.options, {})
}
