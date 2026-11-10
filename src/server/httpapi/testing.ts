import { Effect, Layer, Redacted, Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { HttpServerResponse } from "effect/http";
import { sql } from "kysely";
import { Db } from "../db";
import { Auth } from "../services/auth";
import { gravatarUrl } from "../gravatar";
import { nodeEnv } from "../config"
import { sessionCookiePolicy } from "./session"
import { sessionCookie } from "../../api/session"
import { TestingApi, TestUser } from "../../api/testing"

type TestUserRow = Schema.Schema.Type<typeof TestUser>;

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
          const db = yield* Db;
          yield* db.deleteFrom("app_public.bands").where("name", "like", "Test:%");
          yield* db.deleteFrom("app_public.bands").where("slug", "like", "test-%");
          yield* db.deleteFrom("app_public.users").where("username", "like", "test_%");
          // createUser defaults to the `testuser` prefix, so clear it too.
          yield* db.deleteFrom("app_public.users").where("username", "like", "testuser%");
          return { success: true };
        }, Effect.orDie),
      )
      .handle(
        "seedBand",
        Effect.fnUntraced(
          function* ({ payload }) {
            yield* auth.register({
              username: payload.username,
              email: `${payload.username}@test.local`,
              password: Redacted.make(payload.password),
            }).pipe(Effect.ignore);

            const session = yield* auth.login({
              id: payload.username,
              password: Redacted.make(payload.password),
            });

            const db = yield* Db;
            yield* db.withTransaction(
              Effect.gen(function* () {
                yield* db.selectNoFrom([
                  sql<string>`set_config('my.session_id', ${session.sessionId}, true)`.as("_"),
                ]);
                yield* db
                  .selectFrom(
                    sql`app_public.create_band(
                    slug => ${payload.bandSlug}::citext,
                    name => ${payload.bandName}
                  )`.as("b"),
                  )
                  .selectAll();
              }),
            );

            return { success: true };
          },
          Effect.orElseSucceed(() => ({ success: true })),
        ),
      )
      .handle(
        // Puts a user in a band without an invitation, for specs that are not about invitations.
        "addBandMember",
        Effect.fnUntraced(function* ({ payload }) {
          const db = yield* Db;
          yield* db
            .insertInto("app_public.band_memberships")
            .columns(["band_id", "user_id"])
            .expression((eb) =>
              eb
                .selectFrom("app_public.users")
                .select([sql<string>`${payload.band_id}::uuid`.as("band_id"), "id"])
                .where("username", "=", payload.username),
            );
          return { success: true };
        }, Effect.orDie),
      )
      .handle(
        "testLogin",
        Effect.fnUntraced(
          function* ({ payload }) {
            // Ensure user exists (idempotent)
            yield* auth.register({
              username: payload.username,
              email: `${payload.username}@test.local`,
              password: Redacted.make(payload.password),
            }).pipe(Effect.ignore);

            const result = yield* auth.login({ id: payload.username, password: Redacted.make(payload.password) });
            yield* HttpApiBuilder.securitySetCookie(sessionCookie, result.sessionId, cookie);
            return { success: true };
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
            yield* auth.register({
              username: query.username,
              email: `${query.username}@test.local`,
              password: Redacted.make(query.password),
            }).pipe(Effect.ignore);

            const result = yield* auth.login({
              id: query.username,
              password: Redacted.make(query.password),
            });
            return yield* HttpServerResponse.setCookie(
              HttpServerResponse.redirect("/"),
              sessionCookie.key,
              result.sessionId,
              cookie,
            ).pipe(Effect.orDie);
          },
          Effect.catch((e) =>
            Effect.succeed(
              HttpServerResponse.text(`test login failed: ${e.message}`, { status: 401 }),
            ),
          ),
        ),
      )
      .handle(
        "clearTestUsers",
        Effect.fnUntraced(function* () {
          const db = yield* Db;
          yield* db
            .deleteFrom("app_public.users")
            .where("username", "like", "testuser%")
            .pipe(Effect.orDie);
          return { success: true };
        }),
      )
      .handle(
        "clearTestOrganizations",
        Effect.fnUntraced(function* () {
          const db = yield* Db;
          yield* db.deleteFrom("app_public.bands").where("slug", "like", "test%").pipe(Effect.orDie);
          return { success: true };
        }),
      )
      .handle(
        "createUser",
        Effect.fnUntraced(function* ({ payload }) {
          const db = yield* Db;

          const user = yield* db
            .selectFrom(
              sql<TestUserRow>`
                app_private.really_create_user(
                  username => ${payload.username}::citext,
                  email => ${payload.email},
                  email_is_verified => ${payload.verified},
                  name => ${payload.name ?? payload.username},
                  avatar_url => ${payload.avatarUrl ?? gravatarUrl(payload.email)},
                  password => ${payload.password}::text
                )`.as("u"),
            )
            .selectAll()
            .pipe(Effect.head, Effect.orDie);

          const emailRow = yield* db
            .selectFrom("app_public.user_emails")
            .select("id")
            .where("email", "=", payload.email)
            .orderBy("id", "desc")
            .limit(1)
            .pipe(Effect.head, Effect.orDie);

          const emailSecrets = yield* db
            .selectFrom("app_private.user_email_secrets")
            .selectAll()
            .where("user_email_id", "=", emailRow.id)
            .pipe(Effect.head, Effect.orDie);

          return {
            user,
            userEmailId: emailSecrets.user_email_id,
            verificationToken: payload.verified ? null : emailSecrets.verification_token,
          };
        }),
      )
      .handle(
        "getUserSecrets",
        Effect.fnUntraced(function* ({ query }) {
          const db = yield* Db;
          const user = yield* db
            .selectFrom("app_public.users")
            .select("id")
            .where("username", "=", query.username)
            .pipe(Effect.head, Effect.orDie);
          const row = yield* db
            .selectFrom("app_private.user_secrets")
            .selectAll()
            .where("user_id", "=", user.id)
            .pipe(Effect.head, Effect.orDie);
          return row;
        }),
      )
      .handle(
        "getEmailSecrets",
        Effect.fnUntraced(function* ({ query }) {
          const db = yield* Db;
          const email = yield* db
            .selectFrom("app_public.user_emails")
            .select("id")
            .where("email", "=", query.email)
            .orderBy("id", "desc")
            .limit(1)
            .pipe(Effect.head, Effect.orDie);
          const row = yield* db
            .selectFrom("app_private.user_email_secrets")
            .selectAll()
            .where("user_email_id", "=", email.id)
            .pipe(Effect.head, Effect.orDie);
          const userSecrets = yield* db
            .selectFrom("app_private.user_secrets")
            .innerJoin("app_public.user_emails", "app_public.user_emails.user_id", "app_private.user_secrets.user_id")
            .select("app_private.user_secrets.reset_password_token")
            .where("app_public.user_emails.id", "=", email.id)
            .pipe(Effect.head, Effect.orDie);
          return { ...row, reset_password_token: userSecrets.reset_password_token };
        }),
      )
      .handle(
        "getBandInvitation",
        Effect.fnUntraced(function* ({ query }) {
          const db = yield* Db;
          return yield* db
            .selectFrom("app_public.band_invitations")
            .select(["id", "code"])
            .where("band_id", "=", query.band_id)
            .where("email", "=", query.email)
            .pipe(Effect.head, Effect.orDie);
        }),
      )
      .handle(
        "verifyUser",
        Effect.fnUntraced(function* ({ query }) {
          const db = yield* Db;
          yield* db
            .updateTable("app_public.users")
            .set({ is_verified: true })
            .where("username", "=", query.username)
            .pipe(Effect.orDie);
          return { success: true };
        }),
      )
  })
);

export const TestingHttpApiLive = HttpApiBuilder.layer(TestingApi).pipe(Layer.provide(TestingApiGroupLive));
