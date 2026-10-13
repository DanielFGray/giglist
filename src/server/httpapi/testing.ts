import { Effect, Schema } from "effect";
import { HttpApiBuilder } from "@effect/platform";
import { sql } from "kysely";
import { Db } from "../db";
import * as Auth from "../services/auth";
import {
  SetListApi,
  sessionCookie,
  TestUser,
  TestUserSecrets,
  TestEmailSecrets,
} from "../../api/contracts";

type TestUserRow = Schema.Schema.Type<typeof TestUser>;

if (process.env.NODE_ENV === "production") {
  throw new Error("Testing API must not be loaded in production");
}

const isSecure = process.env.NODE_ENV === "production";

export const testingHandlers = HttpApiBuilder.group(SetListApi, "testing", (handlers) =>
  handlers
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
          yield* Auth.register({
            username: payload.username,
            email: `${payload.username}@test.local`,
            password: payload.password,
          }).pipe(Effect.catchAll(() => Effect.void));

          const session = yield* Auth.login({
            id: payload.username,
            password: payload.password,
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
        Effect.catchAll(() => Effect.succeed({ success: true })),
      ),
    )
    .handle(
      "testLogin",
      Effect.fnUntraced(
        function* ({ payload }) {
          // Ensure user exists (idempotent)
          yield* Auth.register({
            username: payload.username,
            email: `${payload.username}@test.local`,
            password: payload.password,
          }).pipe(Effect.catchAll(() => Effect.void));

          const result = yield* Auth.login({ id: payload.username, password: payload.password });
          yield* HttpApiBuilder.securitySetCookie(sessionCookie, result.sessionId, {
            httpOnly: true,
            sameSite: "lax",
            secure: isSecure,
            path: "/",
            maxAge: "30 days",
          });
          return { success: true };
        },
        Effect.catchAll(() => Effect.succeed({ success: false })),
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
                avatar_url => ${payload.avatarUrl},
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
      Effect.fnUntraced(function* ({ payload }) {
        const db = yield* Db;
        const user = yield* db
          .selectFrom("app_public.users")
          .select("id")
          .where("username", "=", payload.username)
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
      Effect.fnUntraced(function* ({ payload }) {
        const db = yield* Db;
        const email = yield* db
          .selectFrom("app_public.user_emails")
          .select("id")
          .where("email", "=", payload.email)
          .orderBy("id", "desc")
          .limit(1)
          .pipe(Effect.head, Effect.orDie);
        const row = yield* db
          .selectFrom("app_private.user_email_secrets")
          .selectAll()
          .where("user_email_id", "=", email.id)
          .pipe(Effect.head, Effect.orDie);
        return row;
      }),
    )
    .handle(
      "verifyUser",
      Effect.fnUntraced(function* ({ payload }) {
        const db = yield* Db;
        yield* db
          .updateTable("app_public.users")
          .set({ is_verified: true })
          .where("username", "=", payload.username)
          .pipe(Effect.orDie);
        return { success: true };
      }),
    ),
);
