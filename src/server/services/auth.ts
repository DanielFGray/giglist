import { Context, Effect, Layer, Option, Redacted, Schema as S } from "effect";
import { sql } from "kysely";
import { Db, RequestDatabase } from "../db";
import { type DatabaseError, hasSqlState, isDatabaseError } from "../databaseError";
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

/** An emailed invitation's link that cannot sign anyone up: used, cancelled, wrong code, or an address that has an account. */
export class InvitationRefused extends S.TaggedError<InvitationRefused, { readonly brand: unique symbol }>()("InvitationRefused", {
  message: S.String,
}) {}

export type AuthFailure =
  | InvalidCredentials
  | AccountLocked
  | DuplicateAccount
  | WeakPassword
  | RegistrationFailed
  | InvitationRefused;

const emptyToNull = (value: string | null) => {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * Account, session and email operations. Each method yields the connection it
 * needs itself: `Db` (the owner pool) for the token and session functions that
 * run without a signed-in user, and `RequestDatabase` for everything a request
 * does as the user, which only `withAuthContext` provides.
 */
export class Auth extends Context.Service<Auth>()("giglist/auth", {
  make: Effect.sync(() => {
    /** Band owners must transfer or delete those bands before account deletion. */
    const requireNoOwnedBands = Effect.fn("Auth.requireNoOwnedBands")(function* () {
      const db = yield* RequestDatabase;
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

        return { user, sessionId: yield* startSession(user.id) };
      },
      asSignupFailure,
    );

    /**
     * What an emailed invitation's link shows before sign-in. Only the link's
     * code opens it; a wrong code or a used invitation reads as missing.
     */
    const invitationPreview = Effect.fn("Auth.invitationPreview")(function* (invitationId: string, code: string) {
      const db = yield* RequestDatabase;
      return yield* db
        .selectFrom(
          sql<{ band_name: string; email: string; has_account: boolean }>`app_public.invitation_preview(${invitationId}::uuid, ${code}::text)`.as("i"),
        )
        .selectAll()
        .pipe(Effect.head, Effect.catchTag("NoSuchElementError", () => Effect.fail(invitationGone)));
    });

    /**
     * Signs up the person an emailed invitation went to, as a member of its
     * band, and signs them in. The account's email is the invitation's address,
     * verified by the code the link carries, so no verification email follows.
     * One transaction: a refused sign-up joins nobody and uses up nothing.
     */
    const joinByInvitation = Effect.fn("Auth.joinByInvitation")(
      function* (args: { invitationId: string; code: string; username: string; password: Redacted.Redacted<string> }) {
        const db = yield* Db;
        return yield* db.withTransaction(
          Effect.gen(function* () {
            const invitation = yield* db
              .selectFrom(sql<{ email: string }>`app_public.invitation_preview(${args.invitationId}::uuid, ${args.code}::text)`.as("i"))
              .select("email")
              .pipe(Effect.head, Effect.catchTag("NoSuchElementError", () => Effect.fail(invitationGone)));
            const joined = yield* db
              .selectFrom(
                sql<{ user_id: string; band_id: string }>`app_private.join_band_by_invitation(
                  invitation_id => ${args.invitationId}::uuid,
                  code => ${args.code}::text,
                  username => ${args.username}::citext,
                  avatar_url => ${gravatarUrl(invitation.email)},
                  password => ${Redacted.value(args.password)}::text
                )`.as("j"),
              )
              .selectAll()
              .pipe(
                Effect.head,
                Effect.catchTag("NoSuchElementError", () =>
                  Effect.fail(new RegistrationFailed({ message: "Registration failed" })),
                ),
              );
            return { bandId: joined.band_id, sessionId: yield* startSession(joined.user_id) };
          }),
        );
      },
      Effect.catchTag("DatabaseError", (e): Effect.Effect<never, InvitationRefused | DatabaseError> => {
        if (hasSqlState(e, "NTFND") || hasSqlState(e, "INCOD")) return Effect.fail(invitationGone);
        if (hasSqlState(e, "EMTKN"))
          return Effect.fail(new InvitationRefused({ message: "That email already has an account. Sign in to accept the invitation" }));
        return Effect.fail(e);
      }),
      asSignupFailure,
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
      Effect.catchTag("DatabaseError", (e): Effect.Effect<never, AccountLocked | DatabaseError> => {
        if (hasSqlState(e, "LOCKD"))
          return Effect.fail(new AccountLocked({ message: "Account locked — too many attempts" }));
        return Effect.fail(e);
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
    );

    const logout = Effect.fn("Auth.logout")(function* (sessionId: string) {
      const db = yield* Db;
      yield* db.deleteFrom("app_private.sessions").where("uuid", "=", sessionId);
    });

    /** The request's user, or null for an anonymous visitor. */
    const getMe = Effect.fn("Auth.getMe")(function* () {
      const db = yield* RequestDatabase;
      return yield* db
        .selectFrom("app_public.users")
        .select(["id", "username", "name", "bio", "avatar_url", "is_public", "page_theme", "page_options", "role", "is_verified"])
        .where("id", "=", sql<string>`app_public.current_user_id()`)
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
        const db = yield* RequestDatabase;
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
      Effect.catchTag("DatabaseError", (e): Effect.Effect<never, AccountError | DatabaseError> => {
        if (Option.exists(e.report, (r) => r.code === "23505" && Option.contains(r.constraint, "users_username_key")))
          return Effect.fail(new AccountError({ message: "That username is already taken" }));
        if (Option.exists(e.report, (r) => Option.contains(r.constraint, "username_check")))
          return Effect.fail(new AccountError({ message: "That username is not allowed" }));
        if (Option.exists(e.report, (r) => Option.contains(r.constraint, "url_check")))
          return Effect.fail(new AccountError({ message: "Avatar URL must start with http:// or https://" }));
        return Effect.fail(e);
      }),
    );

    const changePassword = Effect.fn("Auth.changePassword")(
      function* (args: {
        oldPassword: Redacted.Redacted<string>;
        newPassword: Redacted.Redacted<string>;
      }) {
        const db = yield* RequestDatabase;
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
      Effect.catchTag("DatabaseError", (e): Effect.Effect<never, AccountError | DatabaseError> => {
        if (hasSqlState(e, "CREDS")) return Effect.fail(new AccountError({ message: "Incorrect password" }));
        if (hasSqlState(e, "LOGIN")) return Effect.fail(new AccountError({ message: "You must be signed in" }));
        if (hasSqlState(e, "WEAKP")) return Effect.fail(new AccountError({ message: "Password is too weak" }));
        return Effect.fail(e);
      }),
    );

    const listEmails = Effect.fn("Auth.listEmails")(function* () {
      const db = yield* RequestDatabase;
      return yield* db
        .selectFrom("app_public.user_emails")
        .select(["id", "email", "is_verified", "is_primary", "created_at"])
        .orderBy("is_primary", "desc")
        .orderBy("created_at", "asc");
    });

    const addEmail = Effect.fn("Auth.addEmail")(
      function* (email: string) {
        const db = yield* RequestDatabase;
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
      Effect.catchTag("DatabaseError", (e): Effect.Effect<never, AccountError | DatabaseError> => {
        if (hasSqlState(e, "EMTKN") || hasSqlState(e, "23505"))
          return Effect.fail(new AccountError({ message: "That email is already in use" }));
        return Effect.fail(e);
      }),
    );

    const removeEmail = Effect.fn("Auth.removeEmail")(
      function* (emailId: string) {
        const db = yield* RequestDatabase;
        const deleted = yield* db
          .deleteFrom("app_public.user_emails")
          .where("id", "=", emailId)
          .returning(["id"]);
        if (deleted.length === 0) {
          return yield* new AccountError({ message: "That email was not found" });
        }
      },
      Effect.catchTag("DatabaseError", (e): Effect.Effect<never, AccountError | DatabaseError> => {
        if (hasSqlState(e, "CDLEA"))
          return Effect.fail(new AccountError({ message: "You must keep at least one verified email" }));
        return Effect.fail(e);
      }),
    );

    const makeEmailPrimary = Effect.fn("Auth.makeEmailPrimary")(
      function* (emailId: string) {
        const db = yield* RequestDatabase;
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
      Effect.catchTag("DatabaseError", (e): Effect.Effect<never, AccountError | DatabaseError> => {
        if (hasSqlState(e, "DNIED")) return Effect.fail(new AccountError({ message: "That's not your email" }));
        if (hasSqlState(e, "VRFY1"))
          return Effect.fail(new AccountError({ message: "Verify the email before making it primary" }));
        return Effect.fail(e);
      }),
    );

    const resendEmailVerification = Effect.fn("Auth.resendEmailVerification")(
      function* (emailId: string) {
        const db = yield* RequestDatabase;
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
    );

    const requestAccountDeletion = Effect.fn("Auth.requestAccountDeletion")(
      function* () {
        yield* requireNoOwnedBands();
        const db = yield* RequestDatabase;
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
      Effect.catchTag("DatabaseError", (e): Effect.Effect<never, AccountError | DatabaseError> => {
        if (hasSqlState(e, "LOGIN")) return Effect.fail(new AccountError({ message: "You must be signed in" }));
        return Effect.fail(e);
      }),
    );

    const confirmAccountDeletion = Effect.fn("Auth.confirmAccountDeletion")(
      function* (token: string) {
        yield* requireNoOwnedBands();
        const db = yield* RequestDatabase;
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
      Effect.catchTag("DatabaseError", (e): Effect.Effect<never, AccountError | DatabaseError> => {
        if (hasSqlState(e, "LOGIN")) return Effect.fail(new AccountError({ message: "You must be signed in" }));
        if (hasSqlState(e, "OWNER"))
          return Effect.fail(
            new AccountError({
              message: "Transfer ownership or delete every band you own before deleting your account",
            }),
          );
        if (hasSqlState(e, "DNIED"))
          return Effect.fail(new AccountError({ message: "That confirmation code is wrong or has expired" }));
        return Effect.fail(e);
      }),
    );

    return {
      register,
      invitationPreview,
      joinByInvitation,
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

const invitationGone = new InvitationRefused({ message: "This invitation link is no longer valid" });

/** A session for a new account, which signs it in. */
const startSession = Effect.fn("Auth.startSession")(function* (userId: string) {
  const db = yield* Db;
  const session = yield* db
    .insertInto("app_private.sessions")
    .values({ user_id: userId })
    .returning(["uuid"])
    .pipe(
      Effect.head,
      Effect.catchTag("NoSuchElementError", () =>
        Effect.fail(new RegistrationFailed({ message: "Failed to create session" })),
      ),
    );
  return session.uuid as string;
});

/** The database's refusals of a new account, as the messages the sign-up forms show. */
const asSignupFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchIf(isDatabaseError, (e): Effect.Effect<never, DuplicateAccount | WeakPassword | DatabaseError> => {
      if (hasSqlState(e, "23505")) return Effect.fail(new DuplicateAccount({ message: "Username or email already taken" }));
      if (hasSqlState(e, "WEAKP")) return Effect.fail(new WeakPassword({ message: "Password is too weak" }));
      return Effect.fail(e);
    }),
  );
