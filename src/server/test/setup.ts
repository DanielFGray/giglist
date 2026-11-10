import { testDatabaseEnv } from "./testDatabase"

// The suite registers more users per minute than the sign-up limit allows, as
// the Playwright suite does, so it runs with the limits off.
Object.assign(process.env, testDatabaseEnv(process.env), { RATE_LIMIT: "off" })
