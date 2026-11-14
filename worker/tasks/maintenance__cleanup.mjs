/** @typedef { import("graphile-worker").Task } Task */

/** @type {Task} */
export default async (_payload, { withPgClient, logger }) => {
  const { rowCount: sessionsRemoved } = await withPgClient(client =>
    client.query(
      `delete from app_private.sessions
       where last_active < now() - interval '30 days'`,
    ),
  )
  const { rowCount: passwordResetsRemoved } = await withPgClient(client =>
    client.query(
      `delete from app_private.unregistered_email_password_resets
       where latest_attempt < now() - interval '30 days'`,
    ),
  )
  logger.info(
    `maintenance__cleanup: deleted ${sessionsRemoved ?? 0} expired sessions and ${passwordResetsRemoved ?? 0} unregistered email password resets`,
  )
}
