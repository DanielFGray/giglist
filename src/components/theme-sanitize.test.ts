import { describe, expect, it } from "bun:test"
import { sanitizeThemeHtml } from "./theme-sanitize"

describe("sanitizeThemeHtml", () => {
  it("keeps a theme document: doctype, styles, fonts, images and links", () => {
    const html = sanitizeThemeHtml(
      '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&display=swap"><style>a > b { color: #fff }</style></head><body><h1 class="x">Band</h1><img src="https://img.example/a.jpg" alt=""></body></html>',
    )
    expect(html).toStartWith("<!DOCTYPE html>")
    expect(html).toContain("a > b { color: #fff }")
    expect(html).toContain("fonts.googleapis.com")
    expect(html).toContain('<img src="https://img.example/a.jpg" alt="">')
  })

  it("strips the band's own code: scripts, handlers, frames and script links", () => {
    const html = sanitizeThemeHtml(
      [
        '<body onload="steal()">',
        "<script>document.body.dataset.ran = 'yes'</script>",
        '<h1 onclick="steal()">Hi</h1>',
        '<a href="javascript:steal()">click</a>',
        '<img src="x" onerror="steal()">',
        '<iframe src="https://evil.example" srcdoc="<script>steal()</script>"></iframe>',
        '<svg><script>steal()</script><a xlink:href="javascript:steal()"><text>x</text></a></svg>',
        '<meta http-equiv="refresh" content="0; url=https://evil.example">',
        '<form action="javascript:steal()"><input formaction="javascript:steal()"></form>',
        "</body>",
      ].join(""),
    )
    expect(html).not.toContain("<script")
    expect(html).not.toContain("steal()")
    expect(html).not.toContain("onload")
    expect(html).not.toContain("onerror")
    expect(html).not.toContain("javascript:")
    expect(html).not.toContain("<iframe")
    expect(html).not.toContain("refresh")
    expect(html).toContain("<h1>Hi</h1>")
  })

  it("keeps a provider player, rebuilt as ours, and drops other iframes", () => {
    const html = sanitizeThemeHtml(
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" onload="steal()" width="9999"></iframe><iframe src="https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC"></iframe>',
    )
    expect(html).toContain('<div class="embed embed-youtube">')
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(html).toContain('<div class="embed embed-spotify">')
    expect(html).not.toContain("steal()")
    expect(html).not.toContain('width="9999"')
  })

  it("keeps an avatar object with a hosted picture, and its fallback without one", () => {
    expect(sanitizeThemeHtml('<object class="avatar" data="https://img.example/bo.png"><span>B</span></object>')).toContain(
      '<object class="avatar" data="https://img.example/bo.png"><span>B</span></object>',
    )
    const dropped = sanitizeThemeHtml('<object data="data:text/html,<script>steal()</script>"><span>B</span></object>')
    expect(dropped).toBe("<span>B</span>")
  })

  it("does not let escaped text become markup, but leaves CSS alone", () => {
    const html = sanitizeThemeHtml("<style>a > b { content: '&gt;' }</style><p>&lt;script&gt; &amp; co</p>")
    expect(html).toContain("a > b")
    expect(html).toContain("<p>&lt;script&gt; &amp; co</p>")
    expect(html).not.toContain("<script>")
  })
})
