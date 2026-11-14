import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Songs, SongRefused } from "../services/songs"
import { asSignedIn } from "./scope"
import { GigListApi } from "../../api/contracts"
import { SongForbidden } from "../../api/songs"

/** A song the member cannot reach answers 403. */
const songRefused = (e: SongRefused) => Effect.fail(new SongForbidden({ message: e.message }))

const asMember = asSignedIn(() => new SongForbidden({ message: "You must be signed in" }))

export const SongsApiGroupLive = HttpApiBuilder.group(GigListApi, "songs", (handlers) =>
  handlers
    .handle("songFindById", ({ params: { id } }) =>
      Songs.use((songs) => songs.byId(id)).pipe(asMember, Effect.catchTags({ SongRefused: songRefused })),
    )
    .handle("songFindByBandId", ({ params: { bandId } }) =>
      Songs.use((songs) => songs.listByBand(bandId)).pipe(asMember, Effect.catchTags({ SongRefused: songRefused })),
    )
    .handle("songCreate", ({ payload }) =>
      Songs.use((songs) => songs.create(payload)).pipe(asMember, Effect.catchTags({ SongRefused: songRefused })),
    )
    .handle("songUpdate", ({ params: { id }, payload }) =>
      Songs.use((songs) => songs.update(id, payload)).pipe(asMember, Effect.catchTags({ SongRefused: songRefused })),
    )
    .handle("songDelete", ({ params: { id } }) =>
      Songs.use((songs) => songs.remove(id)).pipe(asMember, Effect.catchTags({ SongRefused: songRefused })),
    ),
)
