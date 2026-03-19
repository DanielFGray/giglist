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

export const register = (args: {
  username: string
  email: string
  password: string
}) =>
  Effect.gen(function* () {
    const db = yield* Db

    const user = yield* db
      .selectFrom(
        sql`app_private.really_create_user(
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

    const session = yield* db
      .insertInto("app_private.sessions" as any)
      .values({ user_id: user.id })
      .returning(["uuid", "user_id"])
      .pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementException", () =>
          Effect.fail(new RegistrationFailed({ message: "Failed to create session" })),
        ),
      )

    return { user, sessionId: session.uuid as string }
  }).pipe(
    Effect.catchAll((e) => {
      if (
        e._tag === "InvalidCredentials" ||
        e._tag === "DuplicateAccount" ||
        e._tag === "WeakPassword" ||
        e._tag === "RegistrationFailed"
      )
        return Effect.fail(e)
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

    const session = yield* db
      .selectFrom(
        sql`app_private.login(${args.id}::citext, ${args.password})`.as("s"),
      )
      .selectAll()
      .where(sql`s is not null`)
      .pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementException", () =>
          Effect.fail(new InvalidCredentials({ message: "Invalid username or password" })),
        ),
      )

    return { sessionId: session.uuid as string, userId: session.user_id as string }
  }).pipe(
    Effect.catchAll((e) => {
      if (e._tag === "InvalidCredentials") return Effect.fail(e)
      const msg = String(e)
      if (msg.includes("LOCKD"))
        return Effect.fail(new AccountLocked({ message: "Account locked — too many attempts" }))
      return Effect.fail(new InvalidCredentials({ message: "Invalid username or password" }))
    }),
  )

export const logout = (sessionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db
      .deleteFrom("app_private.sessions" as any)
      .where("uuid", "=", sessionId)
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
        sql`(select user_id from app_private.sessions where uuid = ${sessionId}::uuid)`,
      )
      .pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementException", () =>
          Effect.succeed(null),
        ),
      )
  })
