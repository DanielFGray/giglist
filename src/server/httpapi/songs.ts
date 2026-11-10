import { HttpApiBuilder } from "effect/http-api"
import { Songs } from "../services/songs"
import { asSignedIn } from "./scope"
import { GigListApi } from "../../api/contracts"
import { SongForbidden } from "../../api/songs"

const asMember = asSignedIn(() => new SongForbidden({ message: "You must be signed in" }))

export const SongsApiGroupLive = HttpApiBuilder.group(GigListApi, "songs", (handlers) =>
  handlers
    .handle("songFindById", ({ params: { id } }) => Songs.use((songs) => songs.byId(id)).pipe(asMember))
    .handle("songFindByBandId", ({ params: { bandId } }) =>
      Songs.use((songs) => songs.listByBand(bandId)).pipe(asMember),
    )
    .handle("songCreate", ({ payload }) => Songs.use((songs) => songs.create(payload)).pipe(asMember))
    .handle("songUpdate", ({ params: { id }, payload }) =>
      Songs.use((songs) => songs.update(id, payload)).pipe(asMember),
    )
    .handle("songDelete", ({ params: { id } }) => Songs.use((songs) => songs.remove(id)).pipe(asMember)),
)
