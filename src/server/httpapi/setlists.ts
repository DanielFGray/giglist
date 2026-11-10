import { HttpApiBuilder } from "effect/http-api"
import { announced } from "../services/live-hub"
import { Setlists } from "../services/setlists"
import { asSignedIn } from "./scope"
import { GigListApi } from "../../api/contracts"
import { SetlistForbidden } from "../../api/setlists"

/** Setlists and gigs answer a signed-out request with the same 403. */
export const asMember = asSignedIn(() => new SetlistForbidden({ message: "You must be signed in" }))

export const SetlistsApiGroupLive = HttpApiBuilder.group(GigListApi, "setlists", (handlers) =>
  handlers
    .handle("listSetlists", ({ params: { bandId } }) => Setlists.use((s) => s.list(bandId)).pipe(asMember))
    .handle("createSetlist", ({ payload }) => Setlists.use((s) => s.create(payload)).pipe(asMember))
    .handle("getSetlist", ({ params: { id } }) => Setlists.use((s) => s.get(id)).pipe(asMember))
    .handle("updateSetlist", ({ params: { id }, payload }) =>
      Setlists.use((s) => s.update(id, payload)).pipe(asMember, announced),
    )
    .handle("copySetlist", ({ params: { id }, payload }) =>
      Setlists.use((s) => s.copy(id, payload.name)).pipe(asMember),
    )
    .handle("deleteSetlist", ({ params: { id } }) => Setlists.use((s) => s.remove(id)).pipe(asMember, announced))
    .handle("listEntries", ({ params: { id } }) => Setlists.use((s) => s.entries(id)).pipe(asMember))
    .handle("addEntry", ({ params: { id }, payload }) =>
      Setlists.use((s) => s.addEntry(id, payload)).pipe(asMember, announced),
    )
    .handle("updateEntry", ({ params: { id, entryId }, payload }) =>
      Setlists.use((s) => s.updateEntry(id, entryId, payload)).pipe(asMember, announced),
    )
    .handle("deleteEntry", ({ params: { id, entryId } }) =>
      Setlists.use((s) => s.removeEntry(id, entryId)).pipe(asMember, announced),
    )
    .handle("move", ({ params: { id }, payload }) => Setlists.use((s) => s.move(id, payload)).pipe(asMember, announced))
    .handle("watchSetlist", ({ params: { id }, query: { client } }) =>
      Setlists.use((s) => s.watch(id, client)).pipe(asMember),
    )
    .handle("reportPresence", ({ params: { id }, payload }) =>
      Setlists.use((s) => s.report(id, payload)).pipe(asMember),
    ),
)
