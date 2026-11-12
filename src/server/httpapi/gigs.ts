import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Gigs, GigMissing, GigRefused } from "../services/gigs"
import { announced } from "../services/liveHub"
import { asMember, setlistRefused } from "./setlists"
import { GigListApi } from "../../api/contracts"
import { GigNotFound } from "../../api/gigs"
import { SetlistForbidden } from "../../api/setlists"

/** A gig the band cannot see answers 404 with the gig's id. */
const gigMissing = (e: GigMissing) => Effect.fail(new GigNotFound({ message: e.message, id: e.id }))
/** A gig refusal answers 403 with SetlistForbidden: gig and setlist routes share one 403 class. */
const gigRefused = (e: GigRefused) => Effect.fail(new SetlistForbidden({ message: e.message }))

export const GigsApiGroupLive = HttpApiBuilder.group(GigListApi, "gigs", (handlers) =>
  handlers
    .handle("listGigs", ({ params: { bandId } }) =>
      Gigs.use((g) => g.list(bandId)).pipe(asMember, Effect.catchTags({ SetlistRefused: setlistRefused })),
    )
    .handle("createGig", ({ payload }) =>
      Gigs.use((g) => g.create(payload)).pipe(asMember, Effect.catchTags({ SetlistRefused: setlistRefused })),
    )
    .handle("getGig", ({ params: { id } }) =>
      Gigs.use((g) => g.get(id)).pipe(asMember, Effect.catchTags({ GigMissing: gigMissing })),
    )
    .handle("updateGig", ({ params: { id }, payload }) =>
      Gigs.use((g) => g.update(id, payload)).pipe(asMember, announced, Effect.catchTags({ GigMissing: gigMissing })),
    )
    .handle("deleteGig", ({ params: { id } }) =>
      Gigs.use((g) => g.remove(id)).pipe(asMember, announced, Effect.catchTags({ GigMissing: gigMissing })),
    )
    .handle("addGigSetlist", ({ params: { id }, payload }) =>
      Gigs.use((g) => g.addSetlist(id, payload)).pipe(
        asMember,
        announced,
        Effect.catchTags({ GigMissing: gigMissing, GigRefused: gigRefused }),
      ),
    )
    .handle("removeGigSetlist", ({ params: { id, setlistId } }) =>
      Gigs.use((g) => g.removeSetlist(id, setlistId)).pipe(
        asMember,
        announced,
        Effect.catchTags({ GigMissing: gigMissing }),
      ),
    )
    .handle("copyGigSetlist", ({ params: { id, setlistId }, payload }) =>
      Gigs.use((g) => g.copySetlist(id, setlistId, payload.name)).pipe(
        asMember,
        announced,
        Effect.catchTags({ GigMissing: gigMissing, GigRefused: gigRefused }),
      ),
    )
    .handle("moveGigSetlist", ({ params: { id }, payload }) =>
      Gigs.use((g) => g.moveSetlist(id, payload)).pipe(
        asMember,
        announced,
        Effect.catchTags({ GigMissing: gigMissing, GigRefused: gigRefused }),
      ),
    )
    .handle("listGigEntries", ({ params: { id } }) =>
      Gigs.use((g) => g.entries(id)).pipe(asMember, Effect.catchTags({ GigMissing: gigMissing })),
    )
    .handle("watchGig", ({ params: { id }, query: { client } }) =>
      Gigs.use((g) => g.watch(id, client)).pipe(
        asMember,
        Effect.catchTags({ GigMissing: gigMissing, SetlistRefused: setlistRefused }),
      ),
    )
    .handle("reportGigPresence", ({ params: { id }, payload }) =>
      Gigs.use((g) => g.report(id, payload)).pipe(
        asMember,
        Effect.catchTags({ GigMissing: gigMissing, SetlistRefused: setlistRefused }),
      ),
    ),
)
