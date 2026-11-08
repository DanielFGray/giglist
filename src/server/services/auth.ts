import { Context, Effect, Layer, Redacted, Schema as S } from "effect";
import { sql } from "kysely";
import { Db, Kysely } from "../db";
import { pgError } from "./pg-error";
import { gravatarUrl } from "../gravatar";

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

export class AccountError extends S.TaggedError<AccountError, { readonly brand: unique symbol }>()("AccountError", {
  message: S.String,
}) {}

export type AuthError =
  | InvalidCredentials
  | AccountLocked
  | DuplicateAccount
  | WeakPassword
  | RegistrationFailed;

const emptyToNull = (value: string | null) => {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * Account, session and email operations. Each method yields the connection it
 * needs itself: `Db` (the owner pool) for the token and session functions that
 * run without a signed-in user, and `Kysely` for everything a request does as the
 * user, so `withAuthContext` can swap in the visitor's connection per request.
 */
export class Auth extends Context.Service<Auth>()("setlist/Auth", {
  make: Effect.sync(() => {
    /** Band owners must transfer or delete those bands before account deletion. */
    const requireNoOwnedBands = Effect.fn("Auth.requireNoOwnedBands")(function* () {
      const db = yield* Kysely;
      const owned = yield* db
        .selectFrom("app_public.band_memberships")
        .select(["band_id"])
        .where("user_id", "=", sql<string>`app_public.current_user_id()`)
        .where("is_owner", "=", true)
        .limit(1);
      if (owned.length > 0) {
        return yield* new AccountError({
          message: "Transfer ownership or delete every band you own before deleting your account",
        });
      }
    });

    const register = Effect.fn("Auth.register")(
      function* (args: { username: string; email: string; password: Redacted.Redacted<string> }) {
        const db = yield* Db;

        const user = yield* db
          .selectFrom(
            sql<{ id: string }>`app_private.really_create_user(
              username => ${args.username}::citext,
              email => ${args.email},
              email_is_verified => false,
              name => ${null},
              avatar_url => ${gravatarUrl(args.email)},
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
      Effect.catch((e): Effect.Effect<never, AuthError> => {
        if (e._tag === "RegistrationFailed") return Effect.fail(e);
        const info = pgError(e);
        if (info?.code === "23505")
          return Effect.fail(new DuplicateAccount({ message: "Username or email already taken" }));
        if (info?.code === "WEAKP")
          return Effect.fail(new WeakPassword({ message: "Password is too weak" }));
        return Effect.logError("Registration failed", e).pipe(
          Effect.andThen(Effect.fail(new RegistrationFailed({ message: "Registration failed" }))),
        );
      }),
    );

    const login = Effect.fn("Auth.login")(
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
      Effect.catch((e): Effect.Effect<never, InvalidCredentials | AccountLocked> => {
        if (e._tag === "InvalidCredentials") return Effect.fail(e);
        const code = pgError(e)?.code;
        if (code === "LOCKD")
          return Effect.fail(new AccountLocked({ message: "Account locked — too many attempts" }));
        return Effect.logError("login failed", e).pipe(
          Effect.andThen(Effect.fail(new InvalidCredentials({ message: "Invalid username or password" }))),
        );
      }),
    );

    const forgotPassword = Effect.fn("Auth.forgotPassword")(function* (email: string) {
      const db = yield* Db;
      yield* db.selectNoFrom([
        sql<void>`app_public.forgot_password(${email}::citext)`.as("forgot_password"),
      ]);
    });

    const resetPassword = Effect.fn("Auth.resetPassword")(
      function* (args: { userId: string; token: string; password: Redacted.Redacted<string> }) {
        const db = yield* Db;
        const rows = yield* db.selectFrom(
          sql<{ uuid: string; user_id: string }>`app_private.reset_password(
            ${args.userId}::uuid,
            ${args.token},
            ${Redacted.value(args.password)}::text
          )`.as("s"),
        ).selectAll();
        const session = rows.find((row) => row.uuid != null);
        if (!session) return yield* new AccountError({ message: "This reset link is invalid or expired" });
        return { sessionId: session.uuid, userId: session.user_id };
      },
      Effect.catch((e) => {
        if (e._tag === "AccountError") return Effect.fail(e);
        const message = "This reset link is invalid or expired";
        return Effect.logError(message, e).pipe(Effect.andThen(Effect.fail(new AccountError({ message }))));
      }),
    );

    const logout = Effect.fn("Auth.logout")(function* (sessionId: string) {
      const db = yield* Db;
      yield* db.deleteFrom("app_private.sessions").where("uuid", "=", sessionId);
    });

    const getMe = Effect.fn("Auth.getMe")(function* (sessionId: string) {
      const db = yield* Db;
      return yield* db
        .selectFrom("app_public.users")
        .select(["id", "username", "name", "bio", "avatar_url", "is_public", "page_theme", "page_options", "role", "is_verified"])
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

    const updateProfile = Effect.fn("Auth.updateProfile")(
      function* (args: {
        username: string;
        name: string | null;
        bio: string | null;
        avatar_url: string | null;
        is_public?: boolean;
        page_theme?: string | null;
        page_options?: Record<string, string>;
      }) {
        const db = yield* Kysely;
        return yield* db
          .updateTable("app_public.users")
          .set({
            username: args.username,
            name: emptyToNull(args.name),
            bio: emptyToNull(args.bio),
            avatar_url: emptyToNull(args.avatar_url),
            // An absent switch or theme keeps the profile as it was.
            ...(args.is_public === undefined ? {} : { is_public: args.is_public }),
            ...(args.page_theme === undefined ? {} : { page_theme: args.page_theme }),
            ...(args.page_options === undefined ? {} : { page_options: JSON.stringify(args.page_options) }),
          })
          .where("id", "=", sql<string>`app_public.current_user_id()`)
          .returning(["id", "username", "name", "bio", "avatar_url", "is_public", "page_theme", "page_options", "role", "is_verified"])
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementError", () =>
              Effect.fail(new AccountError({ message: "You must be signed in" })),
            ),
          );
      },
      Effect.catch((e) => {
        if (e._tag === "AccountError") return Effect.fail(e);
        const info = pgError(e);
        if (info?.code === "23505" && info.constraint === "users_username_key")
          return Effect.fail(new AccountError({ message: "That username is already taken" }));
        if (info?.constraint === "username_check")
          return Effect.fail(new AccountError({ message: "That username is not allowed" }));
        if (info?.constraint === "url_check")
          return Effect.fail(new AccountError({ message: "Avatar URL must start with http:// or https://" }));
        return Effect.logError("updateProfile failed", e).pipe(
          Effect.andThen(Effect.fail(new AccountError({ message: "Could not update profile" }))),
        );
      }),
    );

    const changePassword = Effect.fn("Auth.changePassword")(
      function* (args: {
        oldPassword: Redacted.Redacted<string>;
        newPassword: Redacted.Redacted<string>;
      }) {
        const db = yield* Kysely;
        // A scalar `select * from fn() as alias` names the column after the alias.
        const ok = yield* db
          .selectFrom(
            sql<{ ok: boolean }>`app_public.change_password(
              ${Redacted.value(args.oldPassword)},
              ${Redacted.value(args.newPassword)}
            )`.as("ok"),
          )
          .selectAll()
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementError", () =>
              Effect.fail(new AccountError({ message: "Could not change password" })),
            ),
          );
        if (!ok.ok) {
          return yield* new AccountError({ message: "Could not change password" });
        }
      },
      Effect.catch((e) => {
        if (e._tag === "AccountError") return Effect.fail(e);
        const code = pgError(e)?.code;
        if (code === "CREDS")
          return Effect.fail(new AccountError({ message: "Incorrect password" }));
        if (code === "LOGIN")
          return Effect.fail(new AccountError({ message: "You must be signed in" }));
        if (code === "WEAKP")
          return Effect.fail(new AccountError({ message: "Password is too weak" }));
        return Effect.logError("Could not change password", e).pipe(
          Effect.andThen(Effect.fail(new AccountError({ message: "Could not change password" }))),
        );
      }),
    );

    const listEmails = Effect.fn("Auth.listEmails")(function* () {
      const db = yield* Kysely;
      return yield* db
        .selectFrom("app_public.user_emails")
        .select(["id", "email", "is_verified", "is_primary", "created_at"])
        .orderBy("is_primary", "desc")
        .orderBy("created_at", "asc");
    });

    const addEmail = Effect.fn("Auth.addEmail")(
      function* (email: string) {
        const db = yield* Kysely;
        return yield* db
          .insertInto("app_public.user_emails")
          .values({ email })
          .returning(["id", "email", "is_verified", "is_primary", "created_at"])
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementError", () =>
              Effect.fail(new AccountError({ message: "Could not add email" })),
            ),
          );
      },
      Effect.catch((e) => {
        if (e._tag === "AccountError") return Effect.fail(e);
        const code = pgError(e)?.code;
        if (code === "EMTKN" || code === "23505")
          return Effect.fail(new AccountError({ message: "That email is already in use" }));
        return Effect.logError("Could not add email", e).pipe(
          Effect.andThen(Effect.fail(new AccountError({ message: "Could not add email" }))),
        );
      }),
    );

    const removeEmail = Effect.fn("Auth.removeEmail")(
      function* (emailId: string) {
        const db = yield* Kysely;
        const deleted = yield* db
          .deleteFrom("app_public.user_emails")
          .where("id", "=", emailId)
          .returning(["id"]);
        if (deleted.length === 0) {
          return yield* new AccountError({ message: "That email was not found" });
        }
      },
      Effect.catch((e) => {
        if (e._tag === "AccountError") return Effect.fail(e);
        const code = pgError(e)?.code;
        if (code === "CDLEA")
          return Effect.fail(
            new AccountError({ message: "You must keep at least one verified email" }),
          );
        return Effect.logError("Could not remove email", e).pipe(
          Effect.andThen(Effect.fail(new AccountError({ message: "Could not remove email" }))),
        );
      }),
    );

    const makeEmailPrimary = Effect.fn("Auth.makeEmailPrimary")(
      function* (emailId: string) {
        const db = yield* Kysely;
        return yield* db
          .selectFrom(
            sql<{
              id: string;
              email: string;
              is_verified: boolean;
              is_primary: boolean;
              created_at: Date;
            }>`app_public.make_email_primary(${emailId}::uuid)`.as("e"),
          )
          .selectAll()
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementError", () =>
              Effect.fail(new AccountError({ message: "Could not update primary email" })),
            ),
          );
      },
      Effect.catch((e) => {
        if (e._tag === "AccountError") return Effect.fail(e);
        const code = pgError(e)?.code;
        if (code === "DNIED")
          return Effect.fail(new AccountError({ message: "That's not your email" }));
        if (code === "VRFY1")
          return Effect.fail(
            new AccountError({ message: "Verify the email before making it primary" }),
          );
        return Effect.logError("Could not update primary email", e).pipe(
          Effect.andThen(Effect.fail(new AccountError({ message: "Could not update primary email" }))),
        );
      }),
    );

    const resendEmailVerification = Effect.fn("Auth.resendEmailVerification")(
      function* (emailId: string) {
        const db = yield* Kysely;
        const ok = yield* db
          .selectFrom(
            sql<{ ok: boolean }>`app_public.resend_email_verification_code(${emailId}::uuid)`.as("ok"),
          )
          .selectAll()
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementError", () =>
              Effect.fail(new AccountError({ message: "Could not resend verification" })),
            ),
          );
        if (!ok.ok) {
          return yield* new AccountError({
            message: "That email is already verified or was not found",
          });
        }
      },
      Effect.catchIf(
        (e): e is Exclude<typeof e, AccountError> => e._tag !== "AccountError",
        (e) => Effect.logError("Could not resend verification", e).pipe(Effect.andThen(Effect.fail(new AccountError({ message: "Could not resend verification" })))),
      ),
    );

    /** Token-gated; runs as the table owner because no session is required. */
    const verifyEmail = Effect.fn("Auth.verifyEmail")(
      function* (args: { id: string; token: string }) {
        const db = yield* Db;
        const ok = yield* db
          .selectFrom(
            sql<{ ok: boolean }>`app_public.verify_email(
              ${args.id}::uuid,
              ${args.token}
            )`.as("ok"),
          )
          .selectAll()
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementError", () =>
              Effect.fail(new AccountError({ message: "Could not verify email" })),
            ),
          );
        if (!ok.ok) {
          return yield* new AccountError({ message: "Invalid or expired verification link" });
        }
      },
      Effect.catchIf(
        (e): e is Exclude<typeof e, AccountError> => e._tag !== "AccountError",
        (e) => Effect.logError("Could not verify email", e).pipe(Effect.andThen(Effect.fail(new AccountError({ message: "Could not verify email" })))),
      ),
    );

    const requestAccountDeletion = Effect.fn("Auth.requestAccountDeletion")(
      function* () {
        yield* requireNoOwnedBands();
        const db = yield* Kysely;
        const ok = yield* db
          .selectFrom(sql<{ ok: boolean }>`app_public.request_account_deletion()`.as("ok"))
          .selectAll()
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementError", () =>
              Effect.fail(new AccountError({ message: "Could not start account deletion" })),
            ),
          );
        if (!ok.ok) {
          return yield* new AccountError({ message: "Could not start account deletion" });
        }
      },
      Effect.catch((e) => {
        if (e._tag === "AccountError") return Effect.fail(e);
        const code = pgError(e)?.code;
        if (code === "LOGIN")
          return Effect.fail(new AccountError({ message: "You must be signed in" }));
        return Effect.logError("Could not start account deletion", e).pipe(
          Effect.andThen(Effect.fail(new AccountError({ message: "Could not start account deletion" }))),
        );
      }),
    );

    const confirmAccountDeletion = Effect.fn("Auth.confirmAccountDeletion")(
      function* (token: string) {
        yield* requireNoOwnedBands();
        const db = yield* Kysely;
        const ok = yield* db
          .selectFrom(
            sql<{ ok: boolean }>`app_public.confirm_account_deletion(${token})`.as("ok"),
          )
          .selectAll()
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementError", () =>
              Effect.fail(new AccountError({ message: "Could not delete account" })),
            ),
          );
        if (!ok.ok) {
          return yield* new AccountError({ message: "Could not delete account" });
        }
      },
      Effect.catch((e) => {
        if (e._tag === "AccountError") return Effect.fail(e);
        const code = pgError(e)?.code;
        if (code === "LOGIN")
          return Effect.fail(new AccountError({ message: "You must be signed in" }));
        if (code === "OWNER")
          return Effect.fail(
            new AccountError({
              message: "Transfer ownership or delete every band you own before deleting your account",
            }),
          );
        if (code === "DNIED")
          return Effect.fail(
            new AccountError({ message: "That confirmation code is wrong or has expired" }),
          );
        return Effect.logError("Could not delete account", e).pipe(
          Effect.andThen(Effect.fail(new AccountError({ message: "Could not delete account" }))),
        );
      }),
    );

    return {
      register,
      login,
      forgotPassword,
      resetPassword,
      logout,
      getMe,
      updateProfile,
      changePassword,
      listEmails,
      addEmail,
      removeEmail,
      makeEmailPrimary,
      resendEmailVerification,
      verifyEmail,
      requestAccountDeletion,
      confirmAccountDeletion,
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
