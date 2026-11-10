/**
 * Points the app's connection strings at the `<name>_test` database on the
 * same server (`giglist_dev_test`, the database `ops dev db` provisions as
 * TEST_DATABASE_URL), so tests never touch the development database.
 * `localhost` is pinned to 127.0.0.1 because the cluster publishes its port on
 * IPv4 only, and a resolver may try ::1 first.
 */
export const testDatabaseEnv = (env: NodeJS.ProcessEnv) => {
  const { DATABASE_URL, AUTH_DATABASE_URL } = env
  if (!DATABASE_URL || !AUTH_DATABASE_URL) {
    throw new Error("DATABASE_URL and AUTH_DATABASE_URL are required; run `ops dev db up`")
  }
  return {
    DATABASE_URL: forceIpv4(withDatabaseSuffix(DATABASE_URL, "_test")),
    AUTH_DATABASE_URL: forceIpv4(withDatabaseSuffix(AUTH_DATABASE_URL, "_test")),
    DATABASE_HOST: "127.0.0.1",
    NODE_ENV: "test",
  }
}

function forceIpv4(connectionString: string): string {
  const url = new URL(connectionString)
  if (url.hostname === "localhost" || url.hostname === "::1") url.hostname = "127.0.0.1"
  return url.toString()
}

function withDatabaseSuffix(connectionString: string, suffix: string): string {
  const url = new URL(connectionString)
  const databaseName = url.pathname.replace(/^\/+/, "")
  if (!databaseName) throw new Error("Connection string is missing a database name")
  url.pathname = `/${databaseName}${suffix}`
  return url.toString()
}
