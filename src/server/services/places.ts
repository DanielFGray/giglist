import { Config, Context, Effect, Layer, Option, Schema as S, String as Str } from "effect"

/** A place a map search found: its name, and its postal address on one line. */
export type Place = { readonly venue: string; readonly address: string | null }

/**
 * Map search for the venue a gig form is typing, through a Photon server
 * (OpenStreetMap data, https://github.com/komoot/photon) at `PLACES_URL`.
 * With no `PLACES_URL` there is no map search, and the form offers only the
 * band's own venues.
 *
 * Only the typed text is sent, under a generic client name, never who typed
 * it. A suggestion is a convenience, so an unreachable, slow or malformed
 * answer is logged and counts as no finds.
 */
export class Places extends Context.Service<Places>()("giglist/places", {
  make: Effect.gen(function* () {
    const url = yield* Config.String("PLACES_URL").pipe(
      Config.option,
      Config.map(Option.filter(Str.isNonEmpty)),
    )

    const search = Effect.fn("Places.search")(function* (query: string) {
      if (Option.isNone(url)) return []
      const endpoint = new URL("/api/", url.value)
      endpoint.searchParams.set("q", query)
      endpoint.searchParams.set("limit", "5")
      // Venues are points with an address ("house") or without one ("other");
      // the other layers are streets, towns and regions.
      endpoint.searchParams.append("layer", "house")
      endpoint.searchParams.append("layer", "other")
      return yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(endpoint, { signal, headers: { "User-Agent": "giglist" } })
          if (!response.ok) throw new Error(`Photon answered ${response.status}`)
          return (await response.json()) as unknown
        },
        catch: (cause) => new MapSearchFailed({ message: String(cause) }),
      }).pipe(
        Effect.flatMap(readPhotonAnswer),
        Effect.timeout("2 seconds"),
        Effect.catch((cause) =>
          Effect.logWarning("map search failed; offering only the band's venues", cause).pipe(Effect.as([])),
        ),
      )
    })

    return { search }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

class MapSearchFailed extends S.TaggedError<MapSearchFailed, { readonly brand: unique symbol }>()("MapSearchFailed", {
  message: S.String,
}) {}

/** The places in a Photon answer that have a name, each with its address. */
export const readPhotonAnswer = (json: unknown) =>
  decodePhoton(json).pipe(
    Effect.map((answer): ReadonlyArray<Place> =>
      answer.features.flatMap(({ properties: p }) => (p.name ? [{ venue: p.name, address: addressLine(p) }] : [])),
    ),
  )

/** "217 East Houston Street, New York, New York 10002, United States", from whichever parts the place has. */
const addressLine = (p: PhotonProperties): string | null => {
  const parts = [words(p.housenumber, p.street), p.city, words(p.state, p.postcode), p.country].filter(
    (part): part is string => !!part,
  )
  return parts.length > 0 ? parts.join(", ") : null
}

const words = (...parts: ReadonlyArray<string | null | undefined>) => parts.filter(Boolean).join(" ")

const part = S.optional(S.NullOr(S.String))

const PhotonProperties = S.Struct({
  name: part,
  housenumber: part,
  street: part,
  city: part,
  state: part,
  postcode: part,
  country: part,
})
type PhotonProperties = typeof PhotonProperties.Type

/** The fields of Photon's GeoJSON answer that an address needs. */
const PhotonAnswer = S.Struct({ features: S.Array(S.Struct({ properties: PhotonProperties })) })

const decodePhoton = S.decodeUnknownEffect(PhotonAnswer)
