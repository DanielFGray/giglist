import { HttpApiBuilder } from "effect/http-api"
import { announced } from "../services/liveHub"
import { Effect } from "effect"
import { Setlists, SetlistMissing, SetlistRefused } from "../services/setlists"
import { asSignedIn } from "./scope"
import { GigListApi } from "../../api/contracts"
import { SetlistForbidden, SetlistNotFound } from "../../api/setlists"

/** Setlists and gigs answer a signed-out request with the same 403. */
export const asMember = asSignedIn(() => new SetlistForbidden({ message: "You must be signed in" }))

/** A setlist the band cannot see answers 404 with the setlist's id. */
const setlistMissing = (e: SetlistMissing) => Effect.fail(new SetlistNotFound({ message: e.message, id: e.id }))
/** A setlist refusal answers 403. Gig handlers reuse it: a gig reads its setlists through the same service. */
export const setlistRefused = (e: SetlistRefused) => Effect.fail(new SetlistForbidden({ message: e.message }))

export const SetlistsApiGroupLive = HttpApiBuilder.group(GigListApi, "setlists", (handlers) =>
  handlers
    .handle("listSetlists", ({ params: { bandId } }) =>
      Setlists.use((s) => s.list(bandId)).pipe(asMember, Effect.catchTags({ SetlistRefused: setlistRefused })),
    )
    .handle("createSetlist", ({ payload }) =>
      Setlists.use((s) => s.create(payload)).pipe(asMember, Effect.catchTags({ SetlistRefused: setlistRefused })),
    )
    .handle("getSetlist", ({ params: { id } }) =>
      Setlists.use((s) => s.get(id)).pipe(asMember, Effect.catchTags({ SetlistMissing: setlistMissing })),
    )
    .handle("updateSetlist", ({ params: { id }, payload }) =>
      Setlists.use((s) => s.update(id, payload)).pipe(
        asMember,
        announced,
        Effect.catchTags({ SetlistMissing: setlistMissing }),
      ),
    )
    .handle("copySetlist", ({ params: { id }, payload }) =>
      Setlists.use((s) => s.copy(id, payload.name)).pipe(asMember, Effect.catchTags({ SetlistMissing: setlistMissing })),
    )
    .handle("deleteSetlist", ({ params: { id } }) =>
      Setlists.use((s) => s.remove(id)).pipe(asMember, announced, Effect.catchTags({ SetlistMissing: setlistMissing })),
    )
    .handle("listEntries", ({ params: { id } }) =>
      Setlists.use((s) => s.entries(id)).pipe(asMember, Effect.catchTags({ SetlistMissing: setlistMissing })),
    )
    .handle("addEntry", ({ params: { id }, payload }) =>
      Setlists.use((s) => s.addEntry(id, payload)).pipe(
        asMember,
        announced,
        Effect.catchTags({ SetlistMissing: setlistMissing, SetlistRefused: setlistRefused }),
      ),
    )
    .handle("updateEntry", ({ params: { id, entryId }, payload }) =>
      Setlists.use((s) => s.updateEntry(id, entryId, payload)).pipe(
        asMember,
        announced,
        Effect.catchTags({ SetlistMissing: setlistMissing, SetlistRefused: setlistRefused }),
      ),
    )
    .handle("deleteEntry", ({ params: { id, entryId } }) =>
      Setlists.use((s) => s.removeEntry(id, entryId)).pipe(
        asMember,
        announced,
        Effect.catchTags({ SetlistMissing: setlistMissing }),
      ),
    )
    .handle("move", ({ params: { id }, payload }) =>
      Setlists.use((s) => s.move(id, payload)).pipe(
        asMember,
        announced,
        Effect.catchTags({ SetlistMissing: setlistMissing, SetlistRefused: setlistRefused }),
      ),
    )
    .handle("watchSetlist", ({ params: { id }, query: { client } }) =>
      Setlists.use((s) => s.watch(id, client)).pipe(
        asMember,
        Effect.catchTags({ SetlistMissing: setlistMissing, SetlistRefused: setlistRefused }),
      ),
    )
    .handle("reportPresence", ({ params: { id }, payload }) =>
      Setlists.use((s) => s.report(id, payload)).pipe(
        asMember,
        Effect.catchTags({ SetlistMissing: setlistMissing, SetlistRefused: setlistRefused }),
      ),
    ),
)
