import { Effect, Layer, Redacted, Schema, Struct } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { sql } from "kysely"
import { ownerDb, withOwnerTransaction } from "../db"
import { IdRow } from "../rows"
import { Auth } from "../services/auth"
import { gravatarUrl } from "../gravatar"
import { nodeEnv } from "../config"
import { sessionCookiePolicy } from "./session"
import { sessionCookie } from "../../api/session"
import { TestBandInvitation, TestEmailSecrets, TestingApi, TestUser, TestUserSecrets } from "../../api/testing"

const TestingApiGroupLive = HttpApiBuilder.group(TestingApi, "testing", (handlers) =>
  Effect.gen(function* () {
    // runtime.ts never imports this module in production; this refusal holds
    // even if something else does.
    if ((yield* nodeEnv) === "production") return yield* Effect.die(new Error("Testing API must not run in production"))
    const auth = yield* Auth
    const cookie = yield* sessionCookiePolicy
    return handlers
      .handle(
        "clear",
        Effect.fnUntraced(function* () {
          yield* ownerDb.exec((k) => k.deleteFrom("app_public.bands").where("name", "like", "Test:%"))
          yield* ownerDb.exec((k) => k.deleteFrom("app_public.bands").where("slug", "like", "test-%"))
          yield* ownerDb.exec((k) => k.deleteFrom("app_public.users").where("username", "like", "test_%"))
          // createUser defaults to the `testuser` prefix, so clear it too.
          yield* ownerDb.exec((k) => k.deleteFrom("app_public.users").where("username", "like", "testuser%"))
          return { success: true }
        }, Effect.orDie),
      )
      .handle(
        "seedBand",
        Effect.fnUntraced(
          function* ({ payload }) {
            yield* auth
              .register({
                username: payload.username,
                email: `${payload.username}@test.local`,
                password: Redacted.make(payload.password),
              })
              .pipe(Effect.ignore)

            const session = yield* auth.login({
              id: payload.username,
              password: Redacted.make(payload.password),
            })

            yield* withOwnerTransaction(
              Effect.gen(function* () {
                yield* ownerDb.exec((k) =>
                  k.selectNoFrom([sql<string>`set_config('my.session_id', ${session.sessionId}, true)`.as("_")]),
                )
                yield* ownerDb.exec((k) =>
                  k
                    .selectFrom(
                      sql`app_public.create_band(
                    slug => ${payload.bandSlug}::citext,
                    name => ${payload.bandName}
                  )`.as("b"),
                    )
                    .selectAll(),
                )
              }),
            )

            return { success: true }
          },
          Effect.orElseSucceed(() => ({ success: true })),
        ),
      )
      .handle(
        // Puts a user in a band without an invitation, for specs that are not about invitations.
        "addBandMember",
        Effect.fnUntraced(function* ({ payload }) {
          yield* ownerDb.exec((k) =>
            k
              .insertInto("app_public.band_memberships")
              .columns(["band_id", "user_id"])
              .expression((eb) =>
                eb
                  .selectFrom("app_public.users")
                  .select([sql<string>`${payload.band_id}::uuid`.as("band_id"), "id"])
                  .where("username", "=", payload.username),
              ),
          )
          return { success: true }
        }, Effect.orDie),
      )
      .handle(
        "setPositionKeys",
        Effect.fnUntraced(function* ({ payload }) {
          yield* withOwnerTransaction(
            Effect.gen(function* () {
              yield* Effect.forEach(payload.entries, (entry) =>
                ownerDb.exec((k) =>
                  k
                    .updateTable("app_public.setlist_entries")
                    .set({ position_key: entry.position_key })
                    .where("id", "=", entry.id),
                ),
              )
              yield* Effect.forEach(payload.gig_setlists, (row) =>
                ownerDb.exec((k) =>
                  k
                    .updateTable("app_public.gig_setlists")
                    .set({ position_key: row.position_key })
                    .where("gig_id", "=", row.gig_id)
                    .where("setlist_id", "=", row.setlist_id),
                ),
              )
            }),
          )
          return { success: true }
        }, Effect.orDie),
      )
      .handle(
        "testLogin",
        Effect.fnUntraced(
          function* ({ payload }) {
            // Ensure user exists (idempotent)
            yield* auth
              .register({
                username: payload.username,
                email: `${payload.username}@test.local`,
                password: Redacted.make(payload.password),
              })
              .pipe(Effect.ignore)

            const result = yield* auth.login({
              id: payload.username,
              password: Redacted.make(payload.password),
            })
            yield* HttpApiBuilder.securitySetCookie(sessionCookie, result.sessionId, cookie)
            return { success: true }
          },
          // Say why it failed: a fixture that answers only `false` turns a test
          // failure into a hunt through the server log.
          Effect.catch((e) => Effect.succeed({ success: false, message: e.message })),
        ),
      )
      .handle(
        // Dev convenience: log in by opening a URL, then land back in the app.
        //
        // A GET that changes state, and credentials in the query string, are both
        // off-spec — acceptable only because this group is test-only (its layer dies
        // at build under NODE_ENV=production) and the user is a fake one.
        "testLoginRedirect",
        Effect.fnUntraced(
          function* ({ query }) {
            // Ensure the user exists, like the POST above (idempotent).
            yield* auth
              .register({
                username: query.username,
                email: `${query.username}@test.local`,
                password: Redacted.make(query.password),
              })
              .pipe(Effect.ignore)

            const result = yield* auth.login({
              id: query.username,
              password: Redacted.make(query.password),
            })
            return yield* HttpServerResponse.setCookie(
              HttpServerResponse.redirect("/"),
              sessionCookie.key,
              result.sessionId,
              cookie,
            ).pipe(Effect.orDie)
          },
          Effect.catch((e) =>
            Effect.succeed(HttpServerResponse.text(`test login failed: ${e.message}`, { status: 401 })),
          ),
        ),
      )
      .handle(
        "clearTestUsers",
        Effect.fnUntraced(function* () {
          yield* ownerDb.exec((k) => k.deleteFrom("app_public.users").where("username", "like", "testuser%"))
          return { success: true }
        }, Effect.orDie),
      )
      .handle(
        "clearTestOrganizations",
        Effect.fnUntraced(function* () {
          yield* ownerDb.exec((k) => k.deleteFrom("app_public.bands").where("slug", "like", "test%"))
          return { success: true }
        }, Effect.orDie),
      )
      .handle(
        "createUser",
        Effect.fnUntraced(function* ({ payload }) {
          const user = yield* ownerDb.one(TestUser, (k) =>
            k
              .selectFrom(
                sql<typeof TestUser.Type>`
                app_private.really_create_user(
                  username => ${payload.username}::citext,
                  email => ${payload.email},
                  email_is_verified => ${payload.verified},
                  name => ${payload.name ?? payload.username},
                  avatar_url => ${payload.avatarUrl ?? gravatarUrl(payload.email)},
                  password => ${payload.password}::text
                )`.as("u"),
              )
              .selectAll(),
          )

          const emailRow = yield* ownerDb.one(IdRow, (k) =>
            k
              .selectFrom("app_public.user_emails")
              .select("id")
              .where("email", "=", payload.email)
              .orderBy("id", "desc")
              .limit(1),
          )

          const emailSecrets = yield* ownerDb.one(EmailSecretsRow, (k) =>
            k.selectFrom("app_private.user_email_secrets").selectAll().where("user_email_id", "=", emailRow.id),
          )

          return {
            user,
            userEmailId: emailSecrets.user_email_id,
            verificationToken: payload.verified ? null : emailSecrets.verification_token,
          }
        }, Effect.orDie),
      )
      .handle(
        "getUserSecrets",
        Effect.fnUntraced(function* ({ query }) {
          const user = yield* ownerDb.one(IdRow, (k) =>
            k.selectFrom("app_public.users").select("id").where("username", "=", query.username),
          )
          return yield* ownerDb.one(TestUserSecrets, (k) =>
            k.selectFrom("app_private.user_secrets").selectAll().where("user_id", "=", user.id),
          )
        }, Effect.orDie),
      )
      .handle(
        "getEmailSecrets",
        Effect.fnUntraced(function* ({ query }) {
          const email = yield* ownerDb.one(IdRow, (k) =>
            k
              .selectFrom("app_public.user_emails")
              .select("id")
              .where("email", "=", query.email)
              .orderBy("id", "desc")
              .limit(1),
          )
          const row = yield* ownerDb.one(EmailSecretsRow, (k) =>
            k.selectFrom("app_private.user_email_secrets").selectAll().where("user_email_id", "=", email.id),
          )
          const userSecrets = yield* ownerDb.one(
            Schema.Struct({ reset_password_token: Schema.NullOr(Schema.String) }),
            (k) =>
              k
                .selectFrom("app_private.user_secrets")
                .innerJoin(
                  "app_public.user_emails",
                  "app_public.user_emails.user_id",
                  "app_private.user_secrets.user_id",
                )
                .select("app_private.user_secrets.reset_password_token")
                .where("app_public.user_emails.id", "=", email.id),
          )
          return { ...row, reset_password_token: userSecrets.reset_password_token }
        }, Effect.orDie),
      )
      .handle(
        "getBandInvitation",
        Effect.fnUntraced(function* ({ query }) {
          return yield* ownerDb.one(TestBandInvitation, (k) =>
            k
              .selectFrom("app_public.band_invitations")
              .select(["id", "code"])
              .where("band_id", "=", query.band_id)
              .where("email", "=", query.email),
          )
        }, Effect.orDie),
      )
      .handle(
        "verifyUser",
        Effect.fnUntraced(function* ({ query }) {
          yield* ownerDb.exec((k) =>
            k.updateTable("app_public.users").set({ is_verified: true }).where("username", "=", query.username),
          )
          return { success: true }
        }, Effect.orDie),
      )
  }),
)

/** `user_email_secrets` without the reset token, which lives on `user_secrets`. */
const EmailSecretsRow = Schema.Struct(Struct.omit(TestEmailSecrets.fields, ["reset_password_token"]))

export const TestingHttpApiLive = HttpApiBuilder.layer(TestingApi).pipe(Layer.provide(TestingApiGroupLive))
