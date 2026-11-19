import { boundaryErrors } from "@danielfgray/stompbox/http"
import { HttpApiMiddleware } from "effect/http-api"
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
} from "./errors"

/**
 * Wraps every endpoint of the contract, so it declares the errors any endpoint
 * can answer. The server's implementation is `FailureBoundaryLayer.make`
 * (src/server/runtime.ts).
 */
export class FailureBoundary extends HttpApiMiddleware.Service<FailureBoundary>()("giglist/FailureBoundary", {
  error: [
    ...boundaryErrors,
    BadCredentials,
    Locked,
    PasswordTooWeak,
    CannotDeleteLastEmail,
    EmailNotVerified,
    InvalidToken,
    UsernameTaken,
    EmailTaken,
    AccountAlreadyLinked,
    AlreadyMember,
    OwnsOrganization,
    SlugTaken,
  ],
}) {}
