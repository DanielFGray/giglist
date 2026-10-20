import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { PublicBandProfileInfo } from "~/api/client"
import { bandScope, renderTheme, themeOptions } from "./band-theme"

const profile: PublicBandProfileInfo = {
  slug: "the-band",
  name: "Café Noir",
  description: "Loud & <proud>",
  page_theme: null,
  page_options: {},
  gigs: [{ venue: "Rooftop", gig_date: "2026-11-07" }, { venue: null, gig_date: "2026-11-20" }],
  members: [
    { username: "ana", name: "Ana", avatar_url: null, is_owner: true },
    { username: "bo", name: null, avatar_url: "https://img.example/bo.png", is_owner: false },
  ],
  songs: [{ title: "Hey Jude", artist: "The Beatles" }, { title: "Original", artist: null }],
}

const render = (source: string, chosen: Record<string, string> = {}) =>
  renderTheme(source, bandScope(profile, "en-US"), chosen)

describe("renderTheme", () => {
  it("prints values escaped", () => {
    expect(render("<h1>{BandName}</h1><p>{Description}</p>")).toBe("<h1>Café Noir</h1><p>Loud &#38; &#60;proud&#62;</p>")
  })

  it("prints the description as rendered Markdown, players included", () => {
    const loud = { ...profile, description: "**Loud** & proud\n\nhttps://youtu.be/dQw4w9WgXcQ" }
    const out = renderTheme("<div>{DescriptionHTML}</div>", bandScope(loud, "en-US"), {})
    expect(out).toContain("<p><strong>Loud</strong> &amp; proud</p>")
    expect(out).toContain('<div class="embed embed-youtube">')
    expect(out).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
  })

  it("repeats a list block per row, with the row's fields in scope", () => {
    expect(render("<block:Song>[{SongNumber}. {SongTitle}<block:SongArtist> by {SongArtist}</block:SongArtist>]</block:Song>"))
      .toBe("[1. Hey Jude by The Beatles][2. Original]")
  })

  it("reads band fields from inside a row", () => {
    expect(render("<block:Gig>{BandName}<block:GigVenue> at {GigVenue}</block:GigVenue>;</block:Gig>")).toBe("Café Noir at Rooftop;Café Noir;")
  })

  it("formats gig dates in the given locale without shifting the day", () => {
    expect(render("<block:Gig>{GigDayOfWeek} {GigMonth} {GigDayOfMonth} {GigYear} {GigISODate};</block:Gig>"))
      .toBe("Sat Nov 7 2026 2026-11-07;Fri Nov 20 2026 2026-11-20;")
  })

  it("opens Not blocks for empty values only", () => {
    expect(render("<block:Member><block:AvatarURL>img</block:AvatarURL><block:NotAvatarURL>{MemberInitial}</block:NotAvatarURL>;</block:Member>"))
      .toBe("A;img;")
    expect(render("<block:Member><block:Owner>*</block:Owner><block:NotOwner>-</block:NotOwner></block:Member>")).toBe("*-")
  })

  it("hides list sections for empty lists", () => {
    const empty = renderTheme("<block:Gigs>shows</block:Gigs><block:NotGigs>none</block:NotGigs>", bandScope({ ...profile, gigs: [] }), {})
    expect(empty).toBe("none")
  })

  it("splits the name into words and graphemes", () => {
    expect(render("<block:NameWord><<block:NameLetter>{Letter}.</block:NameLetter>></block:NameWord>")).toBe("<C.a.f.é.><N.o.i.r.>")
  })

  it("leaves CSS braces and unknown tags as written", () => {
    const css = "a{color:red} b { color: blue } {Unknown} <block:Nope>x</block:Nope>"
    expect(render(css)).toBe("a{color:red} b { color: blue } {Unknown} ")
  })

  it("keeps a stray or unclosed block tag visible instead of dropping the page", () => {
    expect(render("a</block:Gig>b")).toBe("a</block:Gig>b")
    expect(render("a<block:Gig>{GigVenue}")).toBe("a<block:Gig>{GigVenue}")
  })

  it("does not read the old curly block spelling", () => {
    expect(render("{block:Song}x{/block:Song}")).toBe("{block:Song}x{/block:Song}")
  })
})

describe("theme options", () => {
  const theme = `
    <meta name="color:Accent" content="#f59e0b">
    <meta content="" name="image:Header Photo">
    <meta name="text:Tagline" content="Hi">
    <meta name="if:Show Footer" content="true">
    <meta name="color:Accent" content="#000000">
    <meta name="nonsense" content="x">
    <style>a{color:{color:Accent}}</style>
    <block:IfHeaderPhotoImage><img src="{image:Header Photo}"></block:IfHeaderPhotoImage>
    <p>{text:Tagline}</p><block:IfShowFooter>F</block:IfShowFooter><block:IfNotShowFooter>nf</block:IfNotShowFooter>`

  it("lists declared options once, first declaration winning", () => {
    expect(themeOptions(theme).map((o) => [o.key, o.default])).toEqual([
      ["color:Accent", "#f59e0b"],
      ["image:Header Photo", ""],
      ["text:Tagline", "Hi"],
      ["if:Show Footer", "true"],
    ])
  })

  it("prints defaults until the band chooses", () => {
    const out = render(theme)
    expect(out).toContain("a{color:#f59e0b}")
    expect(out).not.toContain("<img")
    expect(out).toContain("<p>Hi</p>F")
  })

  it("prints the band's choices and opens their blocks", () => {
    const out = render(theme, {
      "color:Accent": "#112233",
      "image:Header Photo": "https://img.example/a.jpg",
      "text:Tagline": "<b>",
      "if:Show Footer": "false",
    })
    expect(out).toContain("a{color:#112233}")
    expect(out).toContain('<img src="https://img.example/a.jpg">')
    expect(out).toContain("<p>&#60;b&#62;</p>nf")
  })

  it("falls back to the default when a choice could break out of its attribute or rule", () => {
    const out = render(theme, {
      "color:Accent": "red;}body{display:none",
      "image:Header Photo": 'https://x.example/"onerror="alert(1)',
      "if:Show Footer": "maybe",
    })
    expect(out).toContain("a{color:#f59e0b}")
    expect(out).not.toContain("<img")
    expect(out).toContain("F")
  })

  it("rejects image links that are not http(s)", () => {
    expect(render(theme, { "image:Header Photo": "javascript:alert(1)" })).not.toContain("<img")
  })
})

describe("starter themes", () => {
  const dir = join(import.meta.dir, "themes")
  for (const file of readdirSync(dir)) {
    it(`${file} leaves no tag unfilled`, () => {
      const out = render(readFileSync(join(dir, file), "utf8"))
      expect(out).toContain("Rooftop")
      expect(out.match(/\{\/?(block:)?[A-Z][A-Za-z]*\}|\{(color|image|text):[^}]*\}|<\/?block:[A-Za-z]+>/g)).toBeNull()
    })
  }
})
