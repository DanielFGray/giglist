import { HttpApiBuilder } from "effect/http-api"
import { Gigs } from "../services/gigs"
import { announced } from "../services/liveHub"
import { asMember } from "./setlists"
import { GigListApi } from "../../api/contracts"

export const GigsApiGroupLive = HttpApiBuilder.group(GigListApi, "gigs", (handlers) =>
  handlers
    .handle("listGigs", ({ params: { bandId } }) => Gigs.use((g) => g.list(bandId)).pipe(asMember))
    .handle("createGig", ({ payload }) => Gigs.use((g) => g.create(payload)).pipe(asMember))
    .handle("getGig", ({ params: { id } }) => Gigs.use((g) => g.get(id)).pipe(asMember))
    .handle("updateGig", ({ params: { id }, payload }) => Gigs.use((g) => g.update(id, payload)).pipe(asMember, announced))
    .handle("deleteGig", ({ params: { id } }) => Gigs.use((g) => g.remove(id)).pipe(asMember, announced))
    .handle("addGigSetlist", ({ params: { id }, payload }) =>
      Gigs.use((g) => g.addSetlist(id, payload)).pipe(asMember, announced),
    )
    .handle("removeGigSetlist", ({ params: { id, setlistId } }) =>
      Gigs.use((g) => g.removeSetlist(id, setlistId)).pipe(asMember, announced),
    )
    .handle("copyGigSetlist", ({ params: { id, setlistId }, payload }) =>
      Gigs.use((g) => g.copySetlist(id, setlistId, payload.name)).pipe(asMember, announced),
    )
    .handle("moveGigSetlist", ({ params: { id }, payload }) =>
      Gigs.use((g) => g.moveSetlist(id, payload)).pipe(asMember, announced),
    )
    .handle("listGigEntries", ({ params: { id } }) => Gigs.use((g) => g.entries(id)).pipe(asMember))
    .handle("watchGig", ({ params: { id }, query: { client } }) => Gigs.use((g) => g.watch(id, client)).pipe(asMember))
    .handle("reportGigPresence", ({ params: { id }, payload }) => Gigs.use((g) => g.report(id, payload)).pipe(asMember)),
)
