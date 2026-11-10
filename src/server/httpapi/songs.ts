import { Effect, Schema as S, Struct } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { RequestDatabase, withAuthContext } from "../db";
import { isBandMember } from "./scope";
import { Song, GigListApi, CurrentSession, SongForbidden } from "../../api/contracts";
import {
  songFindById,
  songCreate,
  songDelete,
  songFindByBandId,
} from "../../../generated/queries.js";

const decodeSong = S.decodeUnknownEffect(Song);

/**
 * Require that the session is a member of `bandId`.
 *
 * The policies already refuse a non-member, so this exists to turn "the query
 * returned nothing" into a 403 the browser can show. Both run in the same
 * transaction, so they cannot disagree about who the user is.
 */
const assertBandMember = Effect.fnUntraced(function* (bandId: string) {
  if (!(yield* isBandMember(bandId))) {
    return yield* new SongForbidden({ message: "You are not a member of that band" });
  }
});

/** Run `query` as the session's user, or answer 403 if there is no session. */
const asSession = <A, E>(query: Effect.Effect<A, E, RequestDatabase>) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession;
    if (!session.sessionId) {
      return yield* new SongForbidden({ message: "You must be signed in" });
    }
    return yield* query.pipe(withAuthContext);
  });

/**
 * Reads the song, so the handler can authorise its band before touching it.
 *
 * With RLS on, a song the caller is not a member of is not visible: the query
 * returns nothing, so a missing row and a foreign song look the same. Both are
 * answered 403 — a caller outside the band must not learn the song exists.
 */
const songRow = Effect.fnUntraced(function* (id: string) {
  const db = yield* RequestDatabase;
  return yield* songFindById(db)({ id }).pipe(
    Effect.head,
    Effect.catchTag("NoSuchElementError", () =>
      Effect.fail(new SongForbidden({ message: "You are not a member of that band" })),
    ),
  );
});

export const songsHandlers = HttpApiBuilder.group(GigListApi, "songs", (handlers) =>
  handlers
    .handle(
      "songFindById",
      Effect.fnUntraced(function* ({ params: { id } }) {
        const row = yield* songRow(id);
        return yield* decodeSong(row).pipe(Effect.orDie);
      }, asSession),
    )
    .handle(
      "songFindByBandId",
      Effect.fnUntraced(function* ({ params: { bandId } }) {
        const db = yield* RequestDatabase;
        yield* assertBandMember(bandId);
        return yield* songFindByBandId(db)({ band_id: bandId }).pipe(
          Effect.andThen(S.decodeUnknownEffect(S.Array(Song))),
          Effect.orDie,
        );
      }, asSession),
    )
    .handle(
      "songCreate",
      Effect.fnUntraced(function* ({ payload }) {
        const db = yield* RequestDatabase;
        yield* assertBandMember(payload.band_id);
        // The column default sets created_by to the caller.
        return yield* songCreate(db)({ ...payload }).pipe(
          Effect.head,
          Effect.andThen(decodeSong),
          Effect.orDie,
        );
      }, asSession),
    )
    .handle(
      "songUpdate",
      Effect.fnUntraced(function* ({ params: { id }, payload }) {
        const db = yield* RequestDatabase;
        const existing = yield* songRow(id);
        yield* assertBandMember(existing.band_id);
        // Not the generated songUpdate: it also writes band_id and
        // created_by, and the visitor role may update only the song's own
        // fields. The where clause plus the update policy do the scoping.
        // An empty SET is not valid SQL, and an empty payload changes nothing.
        if (Struct.keys(payload).length === 0)
          return yield* decodeSong(existing).pipe(Effect.orDie);
        return yield* db
          .updateTable("app_public.songs")
          .set(payload)
          .where("id", "=", id)
          .returningAll()
          .pipe(Effect.head, Effect.andThen(decodeSong), Effect.orDie);
      }, asSession),
    )
    .handle(
      "songDelete",
      Effect.fnUntraced(function* ({ params: { id } }) {
        const db = yield* RequestDatabase;
        const existing = yield* songRow(id);
        yield* assertBandMember(existing.band_id);
        return yield* songDelete(db)({ id }).pipe(Effect.asVoid, Effect.orDie);
      }, asSession),
    ),
);
