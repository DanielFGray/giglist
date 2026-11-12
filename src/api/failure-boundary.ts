import { HttpApiMiddleware } from "effect/http-api"
import { InternalError, InvalidOperation } from "./errors"

/**
 * Wraps every endpoint of the contract, so it declares the errors any endpoint
 * can answer. The server's implementation is `FailureBoundaryLive`
 * (src/server/failureBoundary.ts).
 */
export class FailureBoundary extends HttpApiMiddleware.Service<FailureBoundary>()("giglist/FailureBoundary", {
  error: [InternalError, InvalidOperation],
}) {}
