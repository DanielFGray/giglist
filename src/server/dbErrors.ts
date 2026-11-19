import { DatabaseAnswers } from "@danielfgray/stompbox/http/server"
import { Forbidden, NotFound, Unauthorized } from "@danielfgray/stompbox/http"
import {
  AccountAlreadyLinked,
  AlreadyMember,
  BadCredentials,
  CannotDeleteLastEmail,
  EmailNotVerified,
  EmailTaken,
  InvalidToken,
  Locked,
  OwnsOrganization,
  PasswordTooWeak,
  SlugTaken,
  UsernameTaken,
} from "../api/errors"

/**
 * What each database refusal means to a client. `codes` are the custom
 * SQLSTATEs that the SQL functions in migrations/ raise; their messages are
 * written for users and pass through. `constraints` are the unique constraints
 * a user can hit. Standard codes are answered by stompbox with fixed text.
 */
export const toHttpError = DatabaseAnswers.make({
  codes: {
    CREDS: (message) => new BadCredentials({ message }),
    LOGIN: (message) => new Unauthorized({ message }),
    LOCKD: (message) => new Locked({ message }),
    DNIED: (message) => new Forbidden({ message, reason: "access_denied" }),
    NTFND: (message) => new NotFound({ message }),
    WEAKP: (message) => new PasswordTooWeak({ message, requirements: ["At least 8 characters"] }),
    CDLEA: (message) => new CannotDeleteLastEmail({ message }),
    VRFY1: (message) => new EmailNotVerified({ message }),
    VRFY2: (message) => new EmailNotVerified({ message }),
    INCOD: (message) => new InvalidToken({ message }),
    TAKEN: (message) => new AccountAlreadyLinked({ message }),
    EMTKN: (message) => new EmailTaken({ message }),
    ISMBR: (message) => new AlreadyMember({ message }),
    OWNER: (message) => new OwnsOrganization({ message }),
  },
  constraints: {
    users_username_key: new UsernameTaken({ message: "username already exists" }),
    bands_slug_key: new SlugTaken({ message: "That slug is already in use." }),
  },
})
