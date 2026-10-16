import { Effect, Redacted, Schema as S } from "effect";
import { sql } from "kysely";
import { Db } from "../db";

export class InvalidCredentials extends S.TaggedError<InvalidCredentials, { readonly brand: unique symbol }>()("InvalidCredentials", {
  message: S.String,
}) {}

export class AccountLocked extends S.TaggedError<AccountLocked, { readonly brand: unique symbol }>()("AccountLocked", {
  message: S.String,
}) {}

export class DuplicateAccount extends S.TaggedError<DuplicateAccount, { readonly brand: unique symbol }>()("DuplicateAccount", {
  message: S.String,
}) {}

export class WeakPassword extends S.TaggedError<WeakPassword, { readonly brand: unique symbol }>()("WeakPassword", {
  message: S.String,
}) {}

export class RegistrationFailed extends S.TaggedError<RegistrationFailed, { readonly brand: unique symbol }>()("RegistrationFailed", {
  message: S.String,
}) {}

export type AuthError =
  | InvalidCredentials
  | AccountLocked
  | DuplicateAccount
  | WeakPassword
  | RegistrationFailed;

export const register = Effect.fnUntraced(
  function* (args: { username: string; email: string; password: Redacted.Redacted<string> }) {
    const db = yield* Db;

    const user = yield* db
      .selectFrom(
        sql<{ id: string }>`app_private.really_create_user(
          username => ${args.username}::citext,
          email => ${args.email},
          email_is_verified => false,
          name => ${null},
          avatar_url => ${null},
          password => ${Redacted.value(args.password)}::text
        )`.as("u"),
      )
      .selectAll()
      .pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementError", () =>
          Effect.fail(new RegistrationFailed({ message: "Registration failed" })),
        ),
      );

    // app_private.sessions isn't in generated DB types, cast table name
    const session = yield* db
      .insertInto("app_private.sessions")
      .values({ user_id: user.id })
      .returning(["uuid", "user_id"])
      .pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementError", () =>
          Effect.fail(new RegistrationFailed({ message: "Failed to create session" })),
        ),
      );

    return { user, sessionId: session.uuid as string };
  },
  Effect.mapError((e): AuthError => {
    if (e._tag === "RegistrationFailed") return e;
    const msg = String(e);
    if (msg.includes("23505"))
      return new DuplicateAccount({ message: "Username or email already taken" });
    if (msg.includes("WEAKP")) return new WeakPassword({ message: "Password is too weak" });
    return new RegistrationFailed({ message: "Registration failed" });
  }),
);

export const login = Effect.fnUntraced(
  function* (args: { id: string; password: Redacted.Redacted<string> }) {
    const db = yield* Db;

    const rows = yield* db
      .selectFrom(
        sql<{
          uuid: string;
          user_id: string;
        }>`app_private.login(${args.id}::citext, ${Redacted.value(args.password)})`.as("s"),
      )
      .selectAll();

    const session = rows.find((r) => r.uuid != null);
    if (!session) {
      return yield* new InvalidCredentials({ message: "Invalid username or password" });
    }

    return { sessionId: session.uuid, userId: session.user_id };
  },
  Effect.mapError((e): InvalidCredentials | AccountLocked => {
    if (e._tag === "InvalidCredentials") return e;
    const msg = String(e);
    if (msg.includes("LOCKD"))
      return new AccountLocked({ message: "Account locked — too many attempts" });
    return new InvalidCredentials({ message: "Invalid username or password" });
  }),
);

export const logout = Effect.fnUntraced(function* (sessionId: string) {
  const db = yield* Db;
  yield* db
    .selectNoFrom([
      sql<string>`(DELETE FROM app_private.sessions WHERE uuid = ${sessionId}::uuid)`.as("_"),
    ])
    .pipe(Effect.ignore);
});

export const getMe = Effect.fnUntraced(function* (sessionId: string) {
  const db = yield* Db;
  return yield* db
    .selectFrom("app_public.users")
    .select(["id", "username", "name", "avatar_url", "role", "is_verified"])
    .where(
      "id",
      "=",
      sql<string>`(select user_id from app_private.sessions where uuid = ${sessionId}::uuid)`,
    )
    .pipe(
      Effect.head,
      Effect.catchTag("NoSuchElementError", () => Effect.succeed(null)),
    );
});
