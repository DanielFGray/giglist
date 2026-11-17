import { spawnSync } from "node:child_process"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import type { TestProject } from "vitest/node"
import { testDatabaseEnv } from "./testDatabase"

declare module "vitest" {
  export interface ProvidedContext {
    placesUrl: string
  }
}

/**
 * Recreates the `_test` database from the migrations once per vitest run,
 * and starts the stand-in Photon server the suite's map search asks.
 * `bun run test:db` drops the same database, so run the two suites one after
 * the other.
 */
export default async function setup(project: TestProject) {
  const testEnv = { ...process.env, ...testDatabaseEnv(process.env) }
  const testDatabase = new URL(testEnv.DATABASE_URL).pathname.replace(/^\/+/, "")
  run("ops", ["dev", "db", "reset", testDatabase], process.env)
  run("bun", ["-b", "graphile-migrate", "watch", "--once"], testEnv)
  // Registration and invitations queue mail jobs, so the database needs the
  // worker's schema even though no worker runs.
  run("bun", ["-b", "--cwd=worker", "graphile-worker", "--schema-only"], testEnv)

  const photon = await startPhoton()
  project.provide("placesUrl", photon.url)
  return photon.close
}

/**
 * A stand-in for Photon that finds one place per search, named for the text
 * and the point it was asked to search near ("echo near 36.1,-96.0", or
 * "echo near nowhere"), so a test sees what the API sent.
 */
async function startPhoton() {
  const server = createServer((request, response) => {
    const asked = new URL(request.url ?? "/", "http://photon").searchParams
    const lat = asked.get("lat")
    const lon = asked.get("lon")
    const name = `${asked.get("q")} near ${lat === null ? "nowhere" : `${lat},${lon}`}`
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [Number(lon ?? 0), Number(lat ?? 0)] },
        properties: { name, city: "Mapton" },
      }],
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function run(command: string, args: Array<string>, env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`)
}
