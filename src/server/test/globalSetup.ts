import { spawnSync } from "node:child_process"
import { testDatabaseEnv } from "./testDatabase"

/**
 * Recreates the `_test` database from the migrations once per vitest run.
 * `bun run test:db` drops the same database, so run the two suites one after
 * the other.
 */
export default function setup() {
  const testEnv = { ...process.env, ...testDatabaseEnv(process.env) }
  const testDatabase = new URL(testEnv.DATABASE_URL).pathname.replace(/^\/+/, "")
  run("ops", ["dev", "db", "reset", testDatabase], process.env)
  run("bun", ["-b", "graphile-migrate", "watch", "--once"], testEnv)
  // Registration and invitations queue mail jobs, so the database needs the
  // worker's schema even though no worker runs.
  run("bun", ["-b", "--cwd=worker", "graphile-worker", "--schema-only"], testEnv)
}

function run(command: string, args: Array<string>, env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`)
}
