import { Effect, Schema } from "effect"
import { sql } from "kysely"
import { Db } from "../db"

export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()(
  "InvalidCredentials",
  { message: Schema.String },
) {}

export class AccountLocked extends Schema.TaggedError<AccountLocked>()(
  "AccountLocked",
  { message: Schema.String },
) {}

export class DuplicateAccount extends Schema.TaggedError<DuplicateAccount>()(
  "DuplicateAccount",
  { message: Schema.String },
) {}

export class WeakPassword extends Schema.TaggedError<WeakPassword>()(
  "WeakPassword",
  { message: Schema.String },
) {}

export class RegistrationFailed extends Schema.TaggedError<RegistrationFailed>()(
  "RegistrationFailed",
  { message: Schema.String },
) {}

export type AuthError =
  | InvalidCredentials
  | AccountLocked
  | DuplicateAccount
  | WeakPassword
  | RegistrationFailed

export const register = (args: {
  username: string
  email: string
  password: string
}) =>
  Effect.gen(function* () {
    const db = yield* Db

    const user = yield* db
      .selectFrom(
        sql<{ id: string }>`app_private.really_create_user(
          username => ${args.username}::citext,
          email => ${args.email},
          email_is_verified => false,
          name => ${null},
          avatar_url => ${null},
          password => ${args.password}::text
        )`.as("u"),
      )
      .selectAll()
      .pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementException", () =>
          Effect.fail(new RegistrationFailed({ message: "Registration failed" })),
        ),
      )

    // app_private.sessions isn't in generated DB types, cast table name
    const session = yield* db
      .insertInto("app_private.sessions" as any)
      .values({ user_id: user.id } as any)
      .returning(["uuid", "user_id"] as any)
      .pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementException", () =>
          Effect.fail(new RegistrationFailed({ message: "Failed to create session" })),
        ),
      )

    return { user, sessionId: (session as any).uuid as string }
  }).pipe(
    Effect.catchAll((e): Effect.Effect<never, AuthError> => {
      if (typeof e === "object" && e !== null && "_tag" in e) {
        const tag = (e as { _tag: string })._tag
        if (
          tag === "InvalidCredentials" ||
          tag === "DuplicateAccount" ||
          tag === "WeakPassword" ||
          tag === "RegistrationFailed"
        )
          return Effect.fail(e as AuthError)
      }
      const msg = String(e)
      if (msg.includes("23505"))
        return Effect.fail(new DuplicateAccount({ message: "Username or email already taken" }))
      if (msg.includes("WEAKP"))
        return Effect.fail(new WeakPassword({ message: "Password is too weak" }))
      return Effect.fail(new RegistrationFailed({ message: "Registration failed" }))
    }),
  )

export const login = (args: { id: string; password: string }) =>
  Effect.gen(function* () {
    const db = yield* Db

    const rows = yield* db
      .selectFrom(
        sql<{ uuid: string; user_id: string }>`app_private.login(${args.id}::citext, ${args.password})`.as("s"),
      )
      .selectAll()

    const session = rows.find((r) => r.uuid != null)
    if (!session) {
      return yield* Effect.fail(new InvalidCredentials({ message: "Invalid username or password" }))
    }

    return { sessionId: session.uuid, userId: session.user_id }
  }).pipe(
    Effect.catchAll((e): Effect.Effect<never, InvalidCredentials | AccountLocked> => {
      if (typeof e === "object" && e !== null && "_tag" in e) {
        if ((e as { _tag: string })._tag === "InvalidCredentials")
          return Effect.fail(e as InvalidCredentials)
      }
      const msg = String(e)
      if (msg.includes("LOCKD"))
        return Effect.fail(new AccountLocked({ message: "Account locked — too many attempts" }))
      return Effect.fail(new InvalidCredentials({ message: "Invalid username or password" }))
    }),
  )

export const logout = (sessionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db.selectNoFrom([
      sql<string>`(DELETE FROM app_private.sessions WHERE uuid = ${sessionId}::uuid)`.as("_"),
    ]).pipe(Effect.catchAll(() => Effect.void))
  })

export const getMe = (sessionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
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
        Effect.catchTag("NoSuchElementException", () =>
          Effect.succeed(null),
        ),
      )
  })
