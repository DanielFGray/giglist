import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema as S } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { AcceptInvitationSuccess, BandInfo, BandMember } from "../../api/contracts"
import { baseUrl, TestHttpClientLive } from "../test/apiHarness"
import { createBand, postJson, signedIn } from "../test/clients"

const runId = Math.random().toString(36).slice(2, 8)

const listBands = (client: HttpClient.HttpClient) =>
  client.get(`${baseUrl}/my/bands`).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(S.Array(BandInfo))))

describe("bands over HTTP", () => {
  // The requests run as the visitor role on the authenticator connection; on
  // the owner pool, row-level security would not apply and B would see A's band.
  it.effect("a band is visible to its members only", () =>
    Effect.gen(function* () {
      const owner = yield* signedIn(`band_owner_${runId}`)
      const outsider = yield* signedIn(`band_outsider_${runId}`)
      const band = yield* createBand(owner, `rls-${runId}`)

      expect((yield* listBands(owner)).map((b) => b.id)).toContain(band.id)
      expect((yield* listBands(outsider)).map((b) => b.id)).not.toContain(band.id)

      const members = yield* outsider.get(`${baseUrl}/my/bands/${band.id}/members`).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(S.Array(BandMember))),
      )
      expect(members).toEqual([])
    }).pipe(Effect.provide(TestHttpClientLive)))

  it.effect("an emailed invitation is accepted only with its code", () =>
    Effect.gen(function* () {
      const owner = yield* signedIn(`invite_owner_${runId}`)
      const inviteeName = `invitee_${runId}`
      const invitee = yield* signedIn(inviteeName)
      const email = `${inviteeName}@example.com`
      const band = yield* createBand(owner, `invite-${runId}`)

      const sent = yield* postJson(owner, `/my/bands/${band.id}/invite`, { email })
      expect(sent.status).toBe(204)
      const invitation = yield* owner.get(`${baseUrl}/testing/band-invitation?band_id=${band.id}&email=${encodeURIComponent(email)}`).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(S.Struct({ id: S.String, code: S.String }))),
      )

      const wrong = yield* postJson(invitee, `/my/bands/invitations/${invitation.id}/accept`, { code: "not-the-code" })
      expect(wrong.status).toBe(400)
      expect(yield* wrong.json).toMatchObject({ message: "That code does not match this invitation" })
      expect((yield* listBands(invitee)).map((b) => b.id)).not.toContain(band.id)

      const accepted = yield* postJson(invitee, `/my/bands/invitations/${invitation.id}/accept`, { code: invitation.code }).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(AcceptInvitationSuccess)),
      )
      expect(accepted.bandId).toBe(band.id)
      expect((yield* listBands(invitee)).map((b) => b.id)).toContain(band.id)
    }).pipe(Effect.provide(TestHttpClientLive)))
})
