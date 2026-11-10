import { Config } from "effect"

/**
 * The deployment mode, from `NODE_ENV`; unset means development. Production
 * marks the session cookie secure, never mounts the testing API, and sends
 * mail through SES unless `MAIL_PROVIDER` says otherwise.
 */
export const nodeEnv = Config.Literals(["development", "test", "production"], "NODE_ENV").pipe(
  Config.withDefault("development"),
)
