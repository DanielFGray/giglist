import { describe, expect, it } from "bun:test"
import { embedForUrl, renderDescription } from "./description"

describe("renderDescription", () => {
  it("renders Markdown, with links opening in a new tab", () => {
    const html = renderDescription("**Loud** since [day one](https://example.com/about) — see https://example.org/live")
    expect(html).toContain("<strong>Loud</strong>")
    expect(html).toContain('<a href="https://example.com/about" target="_blank" rel="noopener noreferrer">day one</a>')
    expect(html).toContain('<a href="https://example.org/live" target="_blank" rel="noopener noreferrer">https://example.org/live</a>')
  })

  it("shows HTML the band types as text, and refuses script links", () => {
    const html = renderDescription('<script>alert(1)</script> [x](javascript:alert(1)) ![pic](https://img.example/a.jpg)')
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('<img src="https://img.example/a.jpg" alt="pic" loading="lazy">')
  })

  it("embeds a provider link standing alone, but not one inside a sentence", () => {
    const watch = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    const alone = renderDescription(`Our new video:\n\n${watch}\n\nFilmed live.`)
    expect(alone).toContain('<div class="embed embed-youtube">')
    expect(alone).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(alone).toContain('sandbox="allow-scripts allow-same-origin')

    const labelled = renderDescription("[Watch the video](https://youtu.be/dQw4w9WgXcQ)")
    expect(labelled).toContain("embed-youtube")

    const inline = renderDescription(`Watch [the video](${watch}) tonight.`)
    expect(inline).not.toContain("embed-youtube")
    expect(inline).toContain(`<a href="${watch}"`)
  })

  it("reads pasted embed code for its post and replaces it with our player", () => {
    const html = renderDescription(
      'Listen:\n\n<iframe style="border-radius:12px" src="https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC?utm_source=generator" width="100%" height="352" frameBorder="0" allowfullscreen="" allow="autoplay" loading="lazy"></iframe>',
    )
    expect(html).toContain('<div class="embed embed-spotify">')
    expect(html).toContain('src="https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC"')
    expect(html).not.toContain("utm_source")

    const tiktok = renderDescription(
      '<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@band/video/7234567890123456789" data-video-id="7234567890123456789"><section><a href="https://www.tiktok.com/@band/video/7234567890123456789">watch</a></section></blockquote><script async src="https://www.tiktok.com/embed.js"></script>',
    )
    expect(tiktok).toContain('src="https://www.tiktok.com/embed/v2/7234567890123456789"')
    expect(tiktok).not.toContain("embed.js")

    expect(renderDescription('<iframe src="https://evil.example/x"></iframe>')).not.toContain("<iframe")
  })
})

describe("embedForUrl", () => {
  it("recognises each provider's post links", () => {
    expect(embedForUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.src).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")
    expect(embedForUrl("https://open.spotify.com/intl-en/album/4uLU6hMCjMI75M1A2tKUQC")?.height).toBe(352)
    expect(embedForUrl("https://open.spotify.com/episode/4uLU6hMCjMI75M1A2tKUQC")?.height).toBe(152)
    expect(embedForUrl("https://vimeo.com/123456789")?.src).toBe("https://player.vimeo.com/video/123456789")
    expect(embedForUrl("https://www.tiktok.com/@band/video/7234567890123456789")?.provider).toBe("tiktok")
    expect(embedForUrl("https://www.instagram.com/reel/C8abcDEF12_/")?.src).toBe("https://www.instagram.com/reel/C8abcDEF12_/embed")
  })

  it("refuses lookalikes, short links it cannot resolve, and other pages", () => {
    expect(embedForUrl("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(embedForUrl("https://www.youtube.com/channel/UCdQw4w9WgXcQ")).toBeNull()
    expect(embedForUrl("https://vm.tiktok.com/ZMabc123/")).toBeNull()
    expect(embedForUrl("https://open.spotify.com/user/someone")).toBeNull()
    expect(embedForUrl("javascript:alert(1)")).toBeNull()
    expect(embedForUrl("not a url")).toBeNull()
  })
})
