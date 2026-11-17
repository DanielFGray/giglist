import { inject } from "vitest"
import { testDatabaseEnv } from "./testDatabase"

// The suite registers more users per minute than the sign-up limit allows, as
// the Playwright suite does, so it runs with the limits off. Its map search
// asks globalSetup's stand-in Photon, so no test depends on an outside server.
Object.assign(process.env, testDatabaseEnv(process.env), { RATE_LIMIT: "off", PLACES_URL: inject("placesUrl") })
