import { Schema as S } from "effect"

/** A UUID string, as every id on the wire is. */
export const uuid = S.String.check(S.isUUID())
