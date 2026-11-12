/** @typedef { import("../email/emailDelivery").QueuedEmail } SendEmailPayload */
/** @typedef { import("graphile-worker").Task } Task */

/** @typedef {{
  id: string;
}} BandInvitationSendInvitePayload */

/**
 * Emails the invitation. An invitation to an address has a code, which the link
 * carries: the reader has no account yet, so the code is the only proof they were
 * sent it. An invitation to a user's account has no code and goes to that user's
 * primary email.
 * @type {Task}
 */
export default async (inPayload, { addJob, withPgClient, logger }) => {
  /** @type {BandInvitationSendInvitePayload} */
  const payload = inPayload
  const {
    rows: [invitation],
  } = await withPgClient(pgClient =>
    pgClient.query(
      `
        select
          band.name as band_name,
          invitation.code,
          coalesce(invitation.email, primary_email.email) as email
        from app_public.band_invitations as invitation
        join app_public.bands as band on band.id = invitation.band_id
        left join app_public.user_emails as primary_email
          on primary_email.user_id = invitation.user_id and primary_email.is_primary
        where invitation.id = $1
      `,
      [payload.id],
    ),
  )
  // Accepted or declined before the job ran, so there is nothing to send.
  if (!invitation) {
    logger.error('Invitation not found; aborting')
    return
  }
  if (!invitation.email) {
    logger.error('Invitation has no address to send to; aborting')
    return
  }

  const codeParam = invitation.code === null ? '' : `&code=${encodeURIComponent(invitation.code)}`
  /** @type {SendEmailPayload} */
  const sendEmailPayload = {
    options: {
      to: invitation.email,
      subject: `You have been invited to ${invitation.band_name}`,
    },
    template: 'band_invite.mjml',
    variables: {
      bandName: invitation.band_name,
      link: `${process.env.VITE_ROOT_URL}/invitations/accept?id=${encodeURIComponent(payload.id)}${codeParam}`,
    },
  }
  await addJob('send_email', sendEmailPayload)
}
