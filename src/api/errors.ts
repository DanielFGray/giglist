import { Schema as S } from "effect"

/**
 * The refusals this app answers, one tagged class each. The generic classes
 * (`Conflict`, `Forbidden`, ...) come from `@danielfgray/stompbox/http`; the
 * client tells classes apart by `_tag`.
 */

/** A sign-in with a wrong username or password. */
export class BadCredentials extends S.TaggedError<BadCredentials, { readonly brand: unique symbol }>()(
  "BadCredentials",
  { message: S.String },
  { httpApiStatus: 401 },
) {}

/** An account that is locked after too many failed sign-ins. */
export class Locked extends S.TaggedError<Locked, { readonly brand: unique symbol }>()(
  "Locked",
  { message: S.String },
  { httpApiStatus: 423 },
) {}

/** A password that fails the strength rules; `requirements` lists them for the form. */
export class PasswordTooWeak extends S.TaggedError<PasswordTooWeak, { readonly brand: unique symbol }>()(
  "PasswordTooWeak",
  { message: S.String, requirements: S.Array(S.String) },
  { httpApiStatus: 400 },
) {}

/** The last email of an account cannot be deleted. */
export class CannotDeleteLastEmail extends S.TaggedError<CannotDeleteLastEmail, { readonly brand: unique symbol }>()(
  "CannotDeleteLastEmail",
  { message: S.String },
  { httpApiStatus: 400 },
) {}

/** The action needs an email the user has verified. */
export class EmailNotVerified extends S.TaggedError<EmailNotVerified, { readonly brand: unique symbol }>()(
  "EmailNotVerified",
  { message: S.String },
  { httpApiStatus: 400 },
) {}

/** The invitation code in the request is wrong. */
export class InvalidToken extends S.TaggedError<InvalidToken, { readonly brand: unique symbol }>()(
  "InvalidToken",
  { message: S.String },
  { httpApiStatus: 400 },
) {}

export class UsernameTaken extends S.TaggedError<UsernameTaken, { readonly brand: unique symbol }>()(
  "UsernameTaken",
  { message: S.String },
  { httpApiStatus: 409 },
) {}

export class EmailTaken extends S.TaggedError<EmailTaken, { readonly brand: unique symbol }>()(
  "EmailTaken",
  { message: S.String },
  { httpApiStatus: 409 },
) {}

/** A third-party account that another user already linked. */
export class AccountAlreadyLinked extends S.TaggedError<AccountAlreadyLinked, { readonly brand: unique symbol }>()(
  "AccountAlreadyLinked",
  { message: S.String },
  { httpApiStatus: 409 },
) {}

export class AlreadyMember extends S.TaggedError<AlreadyMember, { readonly brand: unique symbol }>()(
  "AlreadyMember",
  { message: S.String },
  { httpApiStatus: 409 },
) {}

/** A user who owns a band cannot be deleted. */
export class OwnsOrganization extends S.TaggedError<OwnsOrganization, { readonly brand: unique symbol }>()(
  "OwnsOrganization",
  { message: S.String },
  { httpApiStatus: 409 },
) {}

export class SlugTaken extends S.TaggedError<SlugTaken, { readonly brand: unique symbol }>()(
  "SlugTaken",
  { message: S.String },
  { httpApiStatus: 409 },
) {}
