import { describe, expect, it } from "bun:test"
import type { PublicUserProfileInfo } from "~/api/client"
import { renderTheme, userScope } from "./band-theme"
import { DEFAULT_USER_THEME } from "./user-theme"

const profile: PublicUserProfileInfo = {
  username: "ana",
  name: "Ana <Drums>",
  bio: "**Drums** & loud\n\nhttps://youtu.be/dQw4w9WgXcQ",
  avatar_url: null,
  page_theme: null,
  page_options: {},
  bands: [
    { slug: "the-band", name: "The Band" },
    { slug: "side", name: "Side Project" },
  ],
}

const render = (source: string, chosen: Record<string, string> = {}, forProfile: PublicUserProfileInfo = profile) =>
  renderTheme(source, userScope(forProfile), chosen)

describe("userScope", () => {
  it("prints who they are, escaped, with the username as the display name until one is set", () => {
    expect(render("<h1>{DisplayName}</h1><p>@{Username} {Initial}</p>")).toBe("<h1>Ana &#60;Drums&#62;</h1><p>@ana A</p>")
    expect(render("{DisplayName}", {}, { ...profile, name: null })).toBe("ana")
  })

  it("renders the bio as Markdown with players, and keeps the source as text", () => {
    const out = render("<div>{BioHTML}</div>")
    expect(out).toContain("<p><strong>Drums</strong> &amp; loud</p>")
    expect(out).toContain('<div class="embed embed-youtube">')
    expect(render("<pre>{Bio}</pre>")).toContain("**Drums** &#38; loud")
  })

  it("repeats the bands block per public band, with a link to each page", () => {
    expect(render("<block:Band>[{BandName}]({BandURL});</block:Band>")).toBe("[The Band](/b/the-band);[Side Project](/b/side);")
    expect(render("<block:Bands>bands</block:Bands>", {}, { ...profile, bands: [] })).toBe("")
  })

  it("splits the display name into words and graphemes", () => {
    expect(render("<block:NameWord><<block:NameLetter>{Letter}.</block:NameLetter>></block:NameWord>")).toBe("<A.n.a.><&#60;.D.r.u.m.s.&#62;.>")
  })
})

describe("the default user theme", () => {
  it("leaves no tag unfilled and shows the profile", () => {
    const out = render(DEFAULT_USER_THEME)
    expect(out).toContain("Ana")
    expect(out).toContain("@ana")
    expect(out).toContain("The Band")
    expect(out).toContain('href="/b/the-band"')
    expect(out.match(/\{\/?(block:)?[A-Z][A-Za-z]*\}|\{(color|image|text):[^}]*\}|<\/?block:[A-Za-z]+>/g)).toBeNull()
  })

  it("prints the theme's options until the user chooses", () => {
    expect(render(DEFAULT_USER_THEME)).toContain("--accent: #f59e0b")
    expect(render(DEFAULT_USER_THEME, { "color:Accent": "#112233" })).toContain("--accent: #112233")
  })
})
