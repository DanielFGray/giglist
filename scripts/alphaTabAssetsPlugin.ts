import { createRequire } from "node:module"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import type { Plugin } from "vite"

/**
 * Serves the files alphaTab fetches by URL at run time under `/alphatab/`.
 *
 * alphaTab starts its render worker and audio worklet from `core.scriptFile`
 * and reads the music font and the sound font from URLs, so these files must
 * be real same-origin files; the bundler cannot inline them. In development a
 * middleware serves them straight from the package; in a build they are
 * emitted into the output folder next to the app. Both come from the installed
 * package, so they always match the version the app imports.
 *
 * `/alphatab/alphaTab.js` is the UMD build on purpose: the worker loads it
 * with `importScripts`, which cannot load an ES module.
 */
export const ALPHATAB_BASE = "/alphatab/"

const SCRIPTS = ["alphaTab.js"]
const DIRECTORIES = ["font", "soundfont"]

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".otf": "font/otf",
  ".sf2": "application/octet-stream",
  ".sf3": "application/octet-stream",
}

export function alphaTabAssetsPlugin(): Plugin {
  // The package's CommonJS entry is dist/alphaTab.js, so its folder is the dist folder.
  const dist = path.dirname(createRequire(import.meta.url).resolve("@coderline/alphatab"))
  let assets: Promise<Map<string, string>> | undefined
  const list = () => (assets ??= collect(dist))

  return {
    name: "alphatab-assets",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? "").split("?", 1)[0] ?? ""
        if (!url.startsWith(ALPHATAB_BASE)) return next()
        const source = (await list()).get(decodeURIComponent(url.slice(ALPHATAB_BASE.length)))
        if (!source) return next()
        res.setHeader("Content-Type", CONTENT_TYPES[path.extname(source)] ?? "application/octet-stream")
        res.end(await readFile(source))
      })
    },
    async generateBundle() {
      for (const [name, source] of await list()) {
        this.emitFile({ type: "asset", fileName: `alphatab/${name}`, source: await readFile(source) })
      }
    },
  }
}

/** Published name (relative to `/alphatab/`) to file on disk, for every file the app serves. */
async function collect(dist: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  for (const script of SCRIPTS) files.set(script, path.join(dist, script))
  for (const directory of DIRECTORIES) {
    for (const entry of await readdir(path.join(dist, directory), { withFileTypes: true })) {
      if (entry.isFile()) files.set(`${directory}/${entry.name}`, path.join(dist, directory, entry.name))
    }
  }
  return files
}
