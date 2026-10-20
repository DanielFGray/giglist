import { Parser } from "htmlparser2"
import { embedForUrl, embedHtml } from "./description"

/**
 * What a band's theme HTML may keep once the page frame allows scripts
 * (docs/adr/0010). The scripts are allowed only so provider players can run
 * inside their own frames; the band's theme still may not run code, so this
 * strips it before the document reaches the frame:
 *
 * - `<script>`, `<frame>`, `<base>`, refresh/policy `<meta>` and every other
 *   `<iframe>` go, tags and (for script/iframe) contents together.
 * - An `<iframe>` whose `src` is a known provider's player stays, rebuilt by
 *   `embedHtml` from the validated post id — a theme can write one by hand
 *   and gets ours, with our sandbox, or nothing.
 * - `on*` handlers, `srcdoc`, and `javascript:`/`vbscript:`/`data:text/html`
 *   links go. An `<object>` keeps only an http(s) picture `data`, else the
 *   tag goes and its fallback content (a member's initial) stays.
 *
 * Everything else — styles, fonts, images, links, inline `style` without a
 * script URL — prints as written. Borrowed: tokenised with htmlparser2
 * <https://github.com/fb55/htmlparser2>, a forgiving HTML parser; see
 * ATTRIBUTIONS.md. The policy above is ours; the parser is what makes
 * stripping it safe against malformed markup.
 */

const DROP_CONTENTS = new Set(["script", "frame", "frameset", "noembed", "noframes", "template"])
const DROP_TAG = new Set(["base", "frame", "frameset", "embed", "keygen", "isindex"])
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])
const URL_ATTRS = new Set(["href", "src", "data", "action", "formaction", "poster", "cite", "background", "longdesc", "usemap", "profile", "xmlns"])

/** Whether a link or source can print: a page, anchor or hosted file, never a script or a document. */
function safeUrl(attr: string, tag: string, value: string): boolean {
  const v = value.trim()
  if (v === "" || v.startsWith("#")) return true
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v)?.[1]?.toLowerCase()
  if (scheme === undefined) return !v.toLowerCase().startsWith("javascript:") // relative or protocol-relative
  if (scheme === "http" || scheme === "https") return true
  if ((scheme === "mailto" || scheme === "tel") && attr === "href") return true
  // An inline picture, in an <img> only: a document or SVG here could run code in an <object>.
  if (scheme === "data" && tag === "img" && attr === "src") return /^data:image\/(png|gif|jpe?g|webp|avif);/i.test(v)
  return false
}

function safeStyle(value: string): boolean {
  return !/(expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:|url\s*\(\s*['"]?\s*(javascript:|data:text))/i.test(value)
}

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
const escapeText = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function openTag(name: string, attribs: Record<string, string>): string {
  const kept: string[] = []
  for (const [rawName, value] of Object.entries(attribs)) {
    const attr = rawName.toLowerCase()
    if (attr.startsWith("on") || attr === "srcdoc") continue
    // `xlink:href` and friends name the same link under a namespace.
    const local = attr.split(":").at(-1)!
    if (URL_ATTRS.has(local) && attr !== "xmlns" && !safeUrl(local, name, value)) continue
    if (attr === "style" && !safeStyle(value)) continue
    kept.push(` ${attr}="${escapeAttr(value)}"`)
  }
  return `<${name}${kept.join("")}>`
}

/** A filled-in theme document with the band's own code stripped; provider players survive. */
export function sanitizeThemeHtml(source: string): string {
  let out = ""
  const dropping: string[] = []
  let styleDepth = 0
  let droppedObjects = 0

  const parser = new Parser(
    {
      onprocessinginstruction: (name) => {
        if (dropping.length === 0 && name === "!doctype") out += "<!DOCTYPE html>"
      },
      onopentag: (name, attribs) => {
        if (dropping.length > 0) {
          dropping.push(name)
          return
        }
        if (DROP_CONTENTS.has(name)) {
          dropping.push(name)
          return
        }
        if (DROP_TAG.has(name)) return
        if (name === "meta") {
          const equiv = (attribs["http-equiv"] ?? "").trim().toLowerCase()
          if (equiv === "refresh" || equiv === "content-security-policy") return
        }
        if (name === "iframe") {
          const embed = embedForUrl(attribs.src ?? "")
          if (embed) out += embedHtml(embed)
          dropping.push(name) // either way, its own fallback content goes
          return
        }
        if (name === "object" && !safeUrl("data", name, attribs.data ?? "")) {
          droppedObjects++
          return // fallback content (a member's initial) stays
        }
        if (name === "style") styleDepth++
        out += openTag(name, attribs)
      },
      ontext: (text) => {
        if (dropping.length > 0) return
        // <style> is raw text in HTML: escaping it would print in the CSS. Its
        // text cannot close anything but the style itself, which the parser reads.
        out += styleDepth > 0 ? text : escapeText(text)
      },
      onclosetag: (name) => {
        if (dropping.length > 0) {
          // Pop to the matching open tag; stray closes inside dropped markup end nothing outside it.
          const at = dropping.lastIndexOf(name)
          if (at >= 0) dropping.length = at
          return
        }
        if (DROP_CONTENTS.has(name) || DROP_TAG.has(name) || name === "iframe") return
        if (name === "object" && droppedObjects > 0) {
          droppedObjects--
          return
        }
        if (name === "style") styleDepth = Math.max(0, styleDepth - 1)
        if (!VOID.has(name)) out += `</${name}>`
      },
      oncomment: (text) => {
        if (dropping.length === 0) out += `<!--${text.replaceAll("--", "- -")}-->`
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: true },
  )
  parser.write(source)
  parser.end()
  return out
}
