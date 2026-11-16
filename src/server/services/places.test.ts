import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { readPhotonAnswer } from "./places"

// Features as photon.komoot.io answers them (trimmed to the fields a
// suggestion reads), plus the cases its answers contain: a missing house number, a place
// with no address at all, and a place with no name.
const answer = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.98, 40.72] },
      properties: {
        osm_key: "amenity",
        osm_value: "nightclub",
        type: "house",
        name: "Mercury Lounge",
        housenumber: "217",
        street: "East Houston Street",
        city: "New York",
        state: "New York",
        postcode: "10002",
        country: "United States",
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-95.98, 36.14] },
      properties: { name: "Mercury Lounge", street: "South Boston Avenue East", city: "Tulsa", state: "Oklahoma", postcode: "74119", country: "United States" },
    },
    { type: "Feature", geometry: { type: "Point", coordinates: [2.35, 48.86] }, properties: { name: "Bandstand" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [-89.65, 39.8] }, properties: { street: "Main Street", city: "Springfield" } },
  ],
}

describe("readPhotonAnswer", () => {
  it.effect("names each place with its point, and its address on one line from whichever parts it has", () =>
    Effect.gen(function* () {
      expect(yield* readPhotonAnswer(answer)).toEqual([
        {
          venue: "Mercury Lounge",
          address: "217 East Houston Street, New York, New York 10002, United States",
          location: { latitude: 40.72, longitude: -73.98 },
        },
        {
          venue: "Mercury Lounge",
          address: "South Boston Avenue East, Tulsa, Oklahoma 74119, United States",
          location: { latitude: 36.14, longitude: -95.98 },
        },
        { venue: "Bandstand", address: null, location: { latitude: 48.86, longitude: 2.35 } },
      ])
    }))
})
