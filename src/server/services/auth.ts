import { Effect, Redacted, Schema as S } from "effect";
import { sql } from "kysely";
import { Db, Kysely } from "../db";

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
    .select(["id", "username", "name", "bio", "avatar_url", "role", "is_verified"])
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

const emptyToNull = (value: string | null) => {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

export const updateProfile = Effect.fnUntraced(
  function* (args: {
    username: string;
    name: string | null;
    bio: string | null;
    avatar_url: string | null;
  }) {
    const db = yield* Kysely;
    return yield* db
      .updateTable("app_public.users")
      .set({
        username: args.username,
        name: emptyToNull(args.name),
        bio: emptyToNull(args.bio),
        avatar_url: emptyToNull(args.avatar_url),
      })
      .where("id", "=", sql<string>`app_public.current_user_id()`)
      .returning(["id", "username", "name", "bio", "avatar_url", "role", "is_verified"])
      .pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementError", () =>
          Effect.fail(new AccountError({ message: "You must be signed in" })),
        ),
      );
  },
  Effect.catch((e) => {
    if (e._tag === "AccountError") return Effect.fail(e);
    const msg = String(e);
    // Match Postgres codes / constraint names, not free text like "username".
    if (msg.includes("23505"))
      return Effect.fail(new AccountError({ message: "That username is already taken" }));
    if (msg.includes("users_username_check") || msg.includes("username_"))
      return Effect.fail(new AccountError({ message: "That username is not allowed" }));
    if (msg.includes("users_avatar_url_check") || msg.includes("domain url"))
      return Effect.fail(
        new AccountError({ message: "Avatar URL must start with http:// or https://" }),
      );
    return Effect.fail(new AccountError({ message: "Could not update profile" }));
  }),
);

export const changePassword = Effect.fnUntraced(
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
    const msg = String(e);
    if (msg.includes("CREDS"))
      return Effect.fail(new AccountError({ message: "Incorrect password" }));
    if (msg.includes("LOGIN"))
      return Effect.fail(new AccountError({ message: "You must be signed in" }));
    if (msg.includes("WEAKP"))
      return Effect.fail(new AccountError({ message: "Password is too weak" }));
    return Effect.fail(new AccountError({ message: "Could not change password" }));
  }),
);

export const listEmails = Effect.fnUntraced(function* () {
  const db = yield* Kysely;
  return yield* db
    .selectFrom("app_public.user_emails")
    .select(["id", "email", "is_verified", "is_primary", "created_at"])
    .orderBy("is_primary", "desc")
    .orderBy("created_at", "asc");
});

export const addEmail = Effect.fnUntraced(
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
    const msg = String(e);
    if (msg.includes("EMTKN") || msg.includes("23505"))
      return Effect.fail(new AccountError({ message: "That email is already in use" }));
    return Effect.fail(new AccountError({ message: "Could not add email" }));
  }),
);

export const removeEmail = Effect.fnUntraced(
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
    const msg = String(e);
    if (msg.includes("CDLEA"))
      return Effect.fail(
        new AccountError({ message: "You must keep at least one verified email" }),
      );
    return Effect.fail(new AccountError({ message: "Could not remove email" }));
  }),
);

export const makeEmailPrimary = Effect.fnUntraced(
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
    const msg = String(e);
    if (msg.includes("DNIED"))
      return Effect.fail(new AccountError({ message: "That's not your email" }));
    if (msg.includes("VRFY1"))
      return Effect.fail(
        new AccountError({ message: "Verify the email before making it primary" }),
      );
    return Effect.fail(new AccountError({ message: "Could not update primary email" }));
  }),
);

export const resendEmailVerification = Effect.fnUntraced(
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
    () => Effect.fail(new AccountError({ message: "Could not resend verification" })),
  ),
);

/** Token-gated; runs as the table owner because no session is required. */
export const verifyEmail = Effect.fnUntraced(
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
    () => Effect.fail(new AccountError({ message: "Could not verify email" })),
  ),
);

/** Band owners must transfer or delete those bands before account deletion. */
const requireNoOwnedBands = Effect.fnUntraced(function* () {
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

export const requestAccountDeletion = Effect.fnUntraced(
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
    const msg = String(e);
    if (msg.includes("LOGIN"))
      return Effect.fail(new AccountError({ message: "You must be signed in" }));
    return Effect.fail(new AccountError({ message: "Could not start account deletion" }));
  }),
);

export const confirmAccountDeletion = Effect.fnUntraced(
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
    const msg = String(e);
    if (msg.includes("LOGIN"))
      return Effect.fail(new AccountError({ message: "You must be signed in" }));
    if (msg.includes("OWNER"))
      return Effect.fail(
        new AccountError({
          message: "Transfer ownership or delete every band you own before deleting your account",
        }),
      );
    if (msg.includes("DNIED"))
      return Effect.fail(
        new AccountError({ message: "That confirmation code is wrong or has expired" }),
      );
    return Effect.fail(new AccountError({ message: "Could not delete account" }));
  }),
);
