import type { Page } from "@playwright/test"
import { test, expect, post, testSlug } from "./helpers"

const song = (page: Page, band_id: string, title: string) =>
  post(page, "/api/songs", { band_id, title, artist: null, key: null, tempo_bpm: null, duration_seconds: null, capo: null, notes: null })

test("concurrent moves preserve different entries and last write wins for one entry", async ({ page, testing, browser }) => {
  const me = await testing.login()
  const band = await post(page, "/api/my/bands", { slug: testSlug("concurrent"), name: "Concurrent" })
  const songs = []
  for (const title of ["Alpha", "Beta", "Gamma", "Delta"]) songs.push(await song(page, band.id, title))
  const setlist = await post(page, "/api/setlists", { band_id: band.id, name: "Concurrent" })
  const entries = []
  for (const s of songs) entries.push(await post(page, `/api/setlists/${setlist.id}/entries`, { song_id: s.id }))
  const contexts = await Promise.all([1, 2].map(async () => {
    const context = await browser.newContext()
    const response = await context.request.post("/api/testing/login", { data: { username: me.username, password: "test_password_123!" } })
    expect(response.ok()).toBe(true)
    return context
  }))
  const move = (context: number, id: string, previous: string | null) =>
    contexts[context]!.request.put(`/api/setlists/${setlist.id}/move`, { data: { id, previous } })
  try {
    const concurrentResponses = await Promise.all([move(0, entries[0].id, entries[2].id), move(1, entries[1].id, entries[0].id)])
    expect(concurrentResponses.every((response) => response.ok())).toBe(true)
    const afterConcurrent = await (await page.request.get(`/api/setlists/${setlist.id}/entries`)).json()
    // The second move names the first move's row as its anchor, so the result depends on which commits first; both orders are valid.
    const [a, b, c, d] = entries.map((entry) => entry.id)
    expect([[c, a, b, d], [b, c, a, d]]).toContainEqual(afterConcurrent.map((entry: { id: string }) => entry.id))
    const sameAnchor = await Promise.all([move(0, entries[0].id, entries[2].id), move(1, entries[1].id, entries[2].id)])
    expect(sameAnchor.every((response) => response.ok())).toBe(true)
    const afterSameAnchor = await (await page.request.get(`/api/setlists/${setlist.id}/entries`)).json()
    expect(new Set(afterSameAnchor.map((entry: { position_key: string }) => entry.position_key)).size).toBe(4)
    expect((await move(0, entries[3].id, entries[1].id)).ok()).toBe(true)
    const eachOther = await Promise.all([move(0, entries[0].id, entries[1].id), move(1, entries[1].id, entries[0].id)])
    expect(eachOther.every((response) => response.ok())).toBe(true)
    expect((await move(0, entries[0].id, null)).ok()).toBe(true)
    expect((await move(1, entries[0].id, entries[3].id)).ok()).toBe(true)
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})

test("parallel adds get distinct keys and a following move lands after its anchor", async ({ page, testing }) => {
  await testing.login()
  const band = await post(page, "/api/my/bands", { slug: testSlug("parallel-add"), name: "Parallel adds" })
  const s = await song(page, band.id, "Song")
  const setlist = await post(page, "/api/setlists", { band_id: band.id, name: "Adds" })
  const responses = await Promise.all(Array.from({ length: 4 }, () => page.request.post(`/api/setlists/${setlist.id}/entries`, { data: { song_id: s.id } })))
  expect(responses.every((response) => response.ok())).toBe(true)
  const added = await Promise.all(responses.map((response) => response.json()))
  expect(new Set(added.map((entry: { position_key: string }) => entry.position_key)).size).toBe(4)
  const moved = await page.request.put(`/api/setlists/${setlist.id}/move`, { data: { id: added[3].id, previous: added[0].id } })
  expect(moved.ok()).toBe(true)
  const entries = await (await page.request.get(`/api/setlists/${setlist.id}/entries`)).json()
  const anchorIndex = entries.findIndex((entry: { id: string }) => entry.id === added[0].id)
  expect(entries[anchorIndex + 1]!.id).toBe(added[3].id)
})

test("rebalances entry and gig setlist keys after repeated neighbour moves", async ({ page, testing }) => {
  await testing.login()
  const band = await post(page, "/api/my/bands", { slug: testSlug("rebalance"), name: "Rebalance" })
  const setlist = await post(page, "/api/setlists", { band_id: band.id, name: "Rebalance" })
  const entries = []
  for (const title of ["Alpha", "Beta", "Gamma"]) {
    const s = await song(page, band.id, title)
    entries.push(await post(page, `/api/setlists/${setlist.id}/entries`, { song_id: s.id }))
  }
  const gig = await post(page, "/api/gigs", { band_id: band.id, venue: "Rebalance", gig_date: null, address: null, load_in_time: null, performance_time: null, notes: null })
  const sets = []
  for (const name of ["Set 1", "Set 2", "Set 3"]) {
    const set = await post(page, "/api/setlists", { band_id: band.id, name })
    await post(page, `/api/gigs/${gig.id}/setlists`, { setlist_id: set.id })
    sets.push(set)
  }
  // Keys at the 32-character limit with no room between neighbours, so the
  // first move in each group must renumber it. Growing keys this long by
  // moves alone takes hundreds of requests.
  const longKey = (last: string) => `${"V".repeat(31)}${last}`
  const seeded = await page.request.put("/api/testing/position-keys", {
    data: {
      entries: entries.map((entry, at) => ({ id: entry.id, position_key: longKey(String(at + 1)) })),
      gig_setlists: sets.map((set, at) => ({ gig_id: gig.id, setlist_id: set.id, position_key: longKey(String(at + 1)) })),
    },
  })
  expect(seeded.ok(), await seeded.text()).toBe(true)
  const move = async (url: string, id: string, previous: string) => {
    const response = await page.request.put(url, { data: { id, previous } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const moveEntry = `/api/setlists/${setlist.id}/move`
  const moveSet = `/api/gigs/${gig.id}/setlists/move`
  for (let index = 0; index < 3; index += 1) {
    await move(moveEntry, entries[0].id, entries[1].id)
    await move(moveEntry, entries[1].id, entries[0].id)
    await move(moveSet, sets[0].id, sets[1].id)
    await move(moveSet, sets[1].id, sets[0].id)
  }
  const finalEntries = await (await page.request.get(`/api/setlists/${setlist.id}/entries`)).json()
  expect(finalEntries.map((entry: { id: string }) => entry.id)).toEqual(entries.map((entry: { id: string }) => entry.id))
  // The third entry never moves, so only a renumber gives it a new key.
  expect(finalEntries.map((entry: { position_key: string }) => entry.position_key.startsWith(longKey("")))).toEqual([false, false, false])
  const finalGig = await (await page.request.get(`/api/gigs/${gig.id}`)).json()
  expect(finalGig.setlists.map((set: { id: string }) => set.id)).toEqual(sets.map((set: { id: string }) => set.id))
})
