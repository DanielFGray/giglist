import type { PublicBandProfileInfo, PublicUserProfileInfo } from "~/api/client"
import { renderDescription } from "./description"

/**
 * Band page themes (docs/adr/0006): a band writes its public page as one HTML
 * document with theme tags, and `renderTheme` fills them in. User profile
 * themes use the same language with their own scope (docs/adr/0012).
 *
 * - `{Name}` prints a value from the data, HTML-escaped.
 * - `<block:Name>…</block:Name>` repeats its body once per row when Name is a
 *   list, and shows it once when Name is a non-empty text or a true flag.
 *   `<block:NotName>` shows its body once when Name is empty, false or an
 *   empty list (a value really called NotName wins).
 * - `<meta name="color:Accent" content="#f59e0b">` declares an option the band
 *   sets in its settings; `{color:Accent}` prints the band's value or the
 *   default. Kinds are `color`, `image` (a linked image URL), `text` and `if`
 *   (a flag, read with `<block:IfName>` / `<block:IfNotName>`). An image option
 *   also opens `<block:IfNameImage>` when it is set.
 *
 * A tag that names nothing stays in the output as written, so CSS such as
 * `a{color:red}` passes through untouched.
 */
export function renderTheme(
  source: string,
  data: ThemeScope,
  chosen: Readonly<Record<string, string>>,
): string {
  const values = optionValues(themeOptions(source), chosen)
  return renderNodes(parse(source), [{ ...optionBlocks(values), ...data }], values)
}

/** Markup made by the app, printed as-is rather than escaped like a band's own text. */
export type Html = { readonly html: string }

/** Data a theme reads: a value prints and opens a block; a list repeats a block per row. */
export type ThemeScope = { readonly [name: string]: string | boolean | Html | ReadonlyArray<ThemeScope> }

export type OptionKind = "color" | "image" | "text" | "if"

export type ThemeOption = {
  kind: OptionKind
  name: string
  /** `kind:name`, as `page_options` stores it. */
  key: string
  default: string
}

/** The options a theme declares with `<meta name="kind:Name" content="default">`, in order, first one per key. */
export function themeOptions(source: string): ThemeOption[] {
  const options = new Map<string, ThemeOption>()
  for (const [tag] of source.matchAll(/<meta\b[^>]*>/gi)) {
    const declared = /^(color|image|text|if):([A-Za-z][A-Za-z0-9 ]*)$/.exec(attribute(tag, "name") ?? "")
    if (!declared) continue
    const kind = declared[1] as OptionKind
    const name = declared[2]!
    const key = `${kind}:${name}`
    if (!options.has(key)) options.set(key, { kind, name, key, default: attribute(tag, "content") ?? "" })
  }
  return [...options.values()]
}

/**
 * The value each option prints: the band's choice when it is valid for the
 * kind, else the theme's default when that is valid, else empty. Colors and
 * image URLs print as written, so they must not carry quotes or brackets; text
 * prints escaped.
 */
export function optionValues(
  options: ReadonlyArray<ThemeOption>,
  chosen: Readonly<Record<string, string>>,
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const option of options) {
    const value = [chosen[option.key], option.default].find(
      (v) => v !== undefined && isValidOptionValue(option.kind, v),
    )
    values[option.key] = option.kind === "text" ? escapeHtml(value ?? "") : (value ?? "")
  }
  return values
}

/** Whether a value can print for an option of this kind; an invalid one falls back to the default. */
export function isValidOptionValue(kind: OptionKind, value: string) {
  return OPTION_VALUE[kind].test(value)
}

const OPTION_VALUE: Record<OptionKind, RegExp> = {
  color: /^#[0-9a-fA-F]{6}$/,
  image: /^(https?:\/\/[^\s"'<>()\\]+)?$/,
  text: /^[^]{0,2000}$/,
  if: /^(true|false)$/,
}

/** What a theme can read about a band; see the tag list in the band settings. */
export function bandScope(profile: PublicBandProfileInfo, locale?: string): ThemeScope {
  const date = (iso: string, format: Intl.DateTimeFormatOptions) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { ...format, timeZone: "UTC" })
  return {
    BandName: profile.name,
    Description: profile.description ?? "",
    // The description as Markdown, rendered (docs/adr/0010): links and
    // provider players are markup, so this prints unescaped, unlike {Description}.
    DescriptionHTML: { html: renderDescription(profile.description ?? "") },
    NameWord: words(profile.name).map((word) => ({
      NameLetter: word.map((letter) => ({ Letter: letter })),
    })),
    Gigs: profile.gigs.length > 0,
    Gig: profile.gigs.map((g) => ({
      GigVenue: g.venue ?? "",
      GigDate: date(g.gig_date, { year: "numeric", month: "short", day: "numeric" }),
      GigISODate: g.gig_date,
      GigDayOfWeek: date(g.gig_date, { weekday: "short" }),
      GigDayOfMonth: date(g.gig_date, { day: "numeric" }),
      GigMonth: date(g.gig_date, { month: "short" }),
      GigYear: date(g.gig_date, { year: "numeric" }),
    })),
    Members: profile.members.length > 0,
    Member: profile.members.map((m) => ({
      MemberName: m.name ?? m.username,
      Username: m.username,
      MemberInitial: [...segments(m.name?.trim() || m.username)][0]?.toUpperCase() ?? "",
      AvatarURL: m.avatar_url ?? "",
      Owner: m.is_owner,
    })),
    Songs: profile.songs.length > 0,
    Song: profile.songs.map((s, i) => ({
      SongTitle: s.title,
      SongArtist: s.artist ?? "",
      SongNumber: String(i + 1),
    })),
  }
}

/** What a profile theme can read about a user; see the tag list in the account settings. */
export function userScope(profile: PublicUserProfileInfo): ThemeScope {
  const displayName = profile.name ?? profile.username
  return {
    DisplayName: displayName,
    Username: profile.username,
    Initial: [...segments(displayName)][0]?.toUpperCase() ?? "",
    AvatarURL: profile.avatar_url ?? "",
    Bio: profile.bio ?? "",
    // The bio as Markdown, rendered (docs/adr/0010): links and provider
    // players are markup, so this prints unescaped, unlike {Bio}.
    BioHTML: { html: renderDescription(profile.bio ?? "") },
    NameWord: words(displayName).map((word) => ({
      NameLetter: word.map((letter) => ({ Letter: letter })),
    })),
    Bands: profile.bands.length > 0,
    Band: profile.bands.map((b) => ({
      BandName: b.name,
      BandSlug: b.slug,
      BandURL: `/b/${b.slug}`,
    })),
  }
}

// --- Parsing ---

type Node =
  | { kind: "text"; text: string }
  | { kind: "value"; name: string; raw: string }
  | { kind: "option"; key: string; raw: string }
  | { kind: "block"; name: string; open: string; close: string; children: Node[] }

const TAG = /<(\/?)block:([A-Za-z][A-Za-z0-9]*)>|\{([A-Za-z][A-Za-z0-9]*)\}|\{((?:color|image|text):[A-Za-z][A-Za-z0-9 ]*)\}/gi

/**
 * The tree of tags in a theme. A closing tag that does not close the innermost
 * open block, and an open block never closed, stay as text: a theme with a
 * typo shows the typo instead of losing the rest of the page.
 */
function parse(source: string): Node[] {
  type Open = { name: string; open: string; children: Node[] }
  const root: Node[] = []
  const stack: Open[] = []
  const into = () => stack.at(-1)?.children ?? root
  let last = 0
  for (const match of source.matchAll(TAG)) {
    const [raw, closing, block, value, option] = match
    if (match.index > last) into().push({ kind: "text", text: source.slice(last, match.index) })
    last = match.index + raw.length
    if (block !== undefined && closing !== "/") {
      stack.push({ name: block, open: raw, children: [] })
    } else if (block !== undefined) {
      const top = stack.at(-1)
      if (top?.name === block) {
        stack.pop()
        into().push({ kind: "block", name: top.name, open: top.open, close: raw, children: top.children })
      } else {
        into().push({ kind: "text", text: raw })
      }
    } else if (value !== undefined) {
      into().push({ kind: "value", name: value, raw })
    } else {
      into().push({ kind: "option", key: option!, raw })
    }
  }
  if (last < source.length) into().push({ kind: "text", text: source.slice(last) })
  while (stack.length > 0) {
    const unclosed = stack.pop()!
    into().push({ kind: "text", text: unclosed.open }, ...unclosed.children)
  }
  return root
}

// --- Rendering ---

function renderNodes(nodes: ReadonlyArray<Node>, scopes: ReadonlyArray<ThemeScope>, values: Record<string, string>): string {
  let out = ""
  for (const node of nodes) {
    if (node.kind === "text") {
      out += node.text
    } else if (node.kind === "option") {
      out += values[node.key] ?? node.raw
    } else if (node.kind === "value") {
      const value = lookup(scopes, node.name)
      out += typeof value === "string" ? escapeHtml(value) : isHtml(value) ? value.html : node.raw
    } else {
      const value = lookup(scopes, node.name)
      if (Array.isArray(value)) {
        for (const row of value as ReadonlyArray<ThemeScope>) out += renderNodes(node.children, [...scopes, row], values)
      } else if (value !== undefined ? isFilled(value) : isEmptyOpposite(scopes, node.name)) {
        out += renderNodes(node.children, scopes, values)
      }
    }
  }
  return out
}

function isHtml(value: string | boolean | Html | ReadonlyArray<ThemeScope> | undefined): value is Html {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as Html).html === "string"
}

function isFilled(value: string | boolean | Html | ReadonlyArray<ThemeScope>) {
  return Array.isArray(value) ? value.length > 0 : isHtml(value) ? value.html !== "" : value !== false && value !== ""
}

/** `NotName` opens when Name is known and empty; an unknown Name opens nothing. */
function isEmptyOpposite(scopes: ReadonlyArray<ThemeScope>, name: string) {
  if (!name.startsWith("Not")) return false
  const opposite = lookup(scopes, name.slice(3))
  return opposite !== undefined && !isFilled(opposite)
}

/** The innermost scope's value wins, so a row's fields shadow the band's. */
function lookup(scopes: ReadonlyArray<ThemeScope>, name: string) {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (Object.hasOwn(scopes[i]!, name)) return scopes[i]![name]
  }
  return undefined
}

/** `<block:IfName>`, `<block:IfNotName>` for flags and `<block:IfNameImage>` for set images. */
function optionBlocks(values: Record<string, string>): ThemeScope {
  const blocks: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(values)) {
    const [kind, name] = key.split(":") as [OptionKind, string]
    const id = name.replaceAll(" ", "")
    if (kind === "if") {
      blocks[`If${id}`] = value === "true"
      blocks[`IfNot${id}`] = value !== "true"
    } else if (kind === "image") {
      blocks[`If${id}Image`] = value !== ""
    }
  }
  return blocks
}

// --- Text ---

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)
  return match ? (match[1] ?? match[2]) : undefined
}

/** Graphemes, so an accented letter or an emoji stays one letter. */
function segments(text: string) {
  return Array.from(new Intl.Segmenter().segment(text), (g) => g.segment)
}

function words(text: string): string[][] {
  return text
    .split(/\s+/)
    .filter((w) => w !== "")
    .map(segments)
}
