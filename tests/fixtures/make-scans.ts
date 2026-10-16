/**
 * Makes the scanned-chart fixtures from amazing-grace.txt, typeset the way a
 * songbook is: lyrics in a proportional font, each chord printed over the
 * lyric character it belongs to.
 *
 *   amazing-grace.pdf       a PDF with a text layer, as a program exports it
 *   amazing-grace.png       the same page as a picture
 *   amazing-grace-scan.pdf  the picture inside a PDF, as a scanner makes it
 *   amazing-grace.bbox.xhtml  the PDF's word boxes (`pdftotext -bbox`)
 *   amazing-grace.tsv       Tesseract's word boxes for the picture, scaled to
 *                           3000 pixels as the browser sends it
 *
 * Needs ImageMagick (`magick`), librsvg (`rsvg-convert`), poppler and
 * tesseract. Run it from the repository root: `bun tests/fixtures/make-scans.ts`.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const dir = new URL(".", import.meta.url).pathname
const FONT_FILE = "/usr/share/fonts/liberation/LiberationSans-Regular.ttf"
const SIZE = 28

/** The width of `text` in the lyric font, in pixels. */
const width = (text: string) =>
  text === ""
    ? 0
    : Number(
        execFileSync("magick", ["-font", FONT_FILE, "-pointsize", `${SIZE}`, `label:${text.replace(/ /g, " ")}`, "-format", "%w", "info:"]),
      )

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;")
const isChordRow = (row: string) => row.trim() !== "" && row.trim().split(/\s+/).every((token) => /^[A-G]/.test(token))

const rows = readFileSync(`${dir}amazing-grace.txt`, "utf8").trimEnd().split("\n")
let y = 50
let body = ""
for (let i = 0; i < rows.length; i++) {
  const row = rows[i]!
  if (isChordRow(row)) {
    const lyric = rows[i + 1] ?? ""
    for (const chord of row.matchAll(/\S+/g)) {
      const x = 40 + width(lyric.slice(0, chord.index))
      body += `<text x="${x}" y="${y}" font-weight="bold">${escape(chord[0])}</text>`
    }
    y += SIZE * 1.15
    continue
  }
  if (row !== "") body += `<text x="40" y="${y}">${escape(row)}</text>`
  y += SIZE * 1.4
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${Math.ceil(y)}">
<rect width="100%" height="100%" fill="white"/>
<g font-family="Liberation Sans" font-size="${SIZE}" fill="black">${body}</g>
</svg>`
writeFileSync(`${dir}amazing-grace.svg`, svg)
execFileSync("rsvg-convert", ["-f", "pdf", "-o", `${dir}amazing-grace.pdf`, `${dir}amazing-grace.svg`])
execFileSync("rsvg-convert", ["-f", "png", "-o", `${dir}amazing-grace.png`, `${dir}amazing-grace.svg`])
execFileSync("magick", [`${dir}amazing-grace.png`, "-colorspace", "Gray", "-density", "96", `${dir}amazing-grace-scan.pdf`])
execFileSync("pdftotext", ["-bbox", `${dir}amazing-grace.pdf`, `${dir}amazing-grace.bbox.xhtml`])
execFileSync("magick", [`${dir}amazing-grace.png`, "-resize", "3000x3000", `${dir}amazing-grace-3000.png`])
execFileSync("tesseract", [`${dir}amazing-grace-3000.png`, `${dir}amazing-grace`, "--psm", "6", "tsv"], { stdio: "ignore" })
execFileSync("rm", [`${dir}amazing-grace.svg`, `${dir}amazing-grace-3000.png`])
