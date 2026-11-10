import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import type { Plugin } from "vite"

/** Where the notices are served from the built app. */
export const LICENSE_NOTICES_PATH = "third-party-licenses.txt"

/**
 * Emits `third-party-licenses.txt` with the license of every npm package whose
 * code is in the client bundle.
 *
 * MIT, Apache-2.0, MPL-2.0 and GPL-2.0 each require their license text to go
 * with every copy, and the bundle a browser downloads is a copy. The list comes
 * from the modules the bundler actually included, not from package.json, so a
 * dependency used only by the server or the tests is not listed, and a new
 * client dependency cannot be missed. The files alphatab-kit serves
 * under `/alphatab/` come from a package the bundle also imports, so its
 * notice is listed; the fonts inside it are covered in ATTRIBUTIONS.md.
 */
export function licenseNoticesPlugin(): Plugin {
  return {
    name: "license-notices",
    apply: "build",
    async generateBundle(_options, bundle) {
      const roots = new Set<string>()
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue
        for (const id of Object.keys(chunk.modules)) {
          const root = packageRoot(id)
          if (root) roots.add(root)
        }
      }
      const notices = await Promise.all([...roots].map(notice))
      const text = notices
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((n) => `${n.name} ${n.version}\nLicense: ${n.license}\n\n${n.text}`.trimEnd())
        .join(`\n\n${"-".repeat(72)}\n\n`)
      this.emitFile({ type: "asset", fileName: LICENSE_NOTICES_PATH, source: `${text}\n` })
    },
  }
}

/**
 * The folder of the npm package that holds a module, or undefined for the
 * app's own code. Bun installs into `node_modules/.bun/<name>@<version>/node_modules/<name>`,
 * so the root is taken after the last `node_modules`, which also handles
 * scoped names and nested installs.
 */
const packageRoot = (id: string): string | undefined => {
  const file = id.replace(/^\0/, "").split("?", 1)[0] ?? ""
  const marker = `${path.sep}node_modules${path.sep}`
  const at = file.lastIndexOf(marker)
  if (at < 0) return undefined
  const rest = file.slice(at + marker.length).split(path.sep)
  const depth = rest[0]?.startsWith("@") ? 2 : 1
  return file.slice(0, at + marker.length) + rest.slice(0, depth).join(path.sep)
}

const notice = async (root: string) => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    name: string
    version: string
    license?: string
  }
  const file = (await readdir(root)).find((name) => /^(licen[cs]e|copying)(\.|$)/i.test(name))
  const text = file
    ? await readFile(path.join(root, file), "utf8")
    : `No license file is included in the package; its package.json declares ${pkg.license ?? "no license"}.`
  return { name: pkg.name, version: pkg.version, license: pkg.license ?? "UNKNOWN", text }
}
