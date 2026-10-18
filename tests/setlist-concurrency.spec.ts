import { test, expect } from "./helpers"

test("concurrent moves preserve different entries and last write wins for one entry", async ({ page, testing, browser }) => {
  await testing.login()
  const band = await (await page.request.post("/api/my/bands", { data: { slug: `test-concurrent-${Date.now()}`, name: "Concurrent" } })).json()
  const songs = []
  for (const title of ["Alpha", "Beta", "Gamma", "Delta"]) {
    songs.push(await (await page.request.post("/api/songs", { data: { band_id: band.id, title, artist: null, key: null, tempo_bpm: null, duration_seconds: null, capo: null, notes: null } })).json())
  }
  const setlist = await (await page.request.post("/api/setlists", { data: { band_id: band.id, name: "Concurrent", description: null, gig_date: null, status: "draft" } })).json()
  const entries = []
  for (const song of songs) entries.push(await (await page.request.post(`/api/setlists/${setlist.id}/entries`, { data: { song_id: song.id } })).json())
  const contexts = await Promise.all([1, 2].map(async () => {
    const context = await browser.newContext()
    const response = await context.request.post("/api/testing/login", { data: { username: "test_admin", password: "test_password_123!" } })
    expect(response.ok()).toBe(true)
    return context
  }))
  try {
    const concurrentResponses = await Promise.all([
      contexts[0]!.request.put(`/api/setlists/${setlist.id}/move`, { data: { kind: "entry", id: entries[0].id, section_id: null, previous: entries[2].id } }),
      contexts[1]!.request.put(`/api/setlists/${setlist.id}/move`, { data: { kind: "entry", id: entries[1].id, section_id: null, previous: entries[0].id } }),
    ])
    expect(concurrentResponses.every((response) => response.ok())).toBe(true)
    const afterConcurrent = await (await page.request.get(`/api/setlists/${setlist.id}/entries`)).json()
    // The second move names the first move's row as its anchor, so the result depends on which commits first; both orders are valid.
    const [a, b, c, d] = entries.map((entry) => entry.id)
    expect([[c, a, b, d], [b, c, a, d]]).toContainEqual(afterConcurrent.map((entry: { id: string }) => entry.id))
    const sameAnchor = await Promise.all([
      contexts[0]!.request.put(`/api/setlists/${setlist.id}/move`, { data: { kind: "entry", id: entries[0].id, section_id: null, previous: entries[2].id } }),
      contexts[1]!.request.put(`/api/setlists/${setlist.id}/move`, { data: { kind: "entry", id: entries[1].id, section_id: null, previous: entries[2].id } }),
    ])
    expect(sameAnchor.every((response) => response.ok())).toBe(true)
    const afterSameAnchor = await (await page.request.get(`/api/setlists/${setlist.id}/entries`)).json()
    expect(new Set(afterSameAnchor.map((entry: { position_key: string }) => entry.position_key)).size).toBe(4)
    const later = await contexts[0]!.request.put(`/api/setlists/${setlist.id}/move`, { data: { kind: "entry", id: entries[3].id, section_id: null, previous: entries[1].id } })
    expect(later.ok()).toBe(true)
    const eachOther = await Promise.all([
      contexts[0]!.request.put(`/api/setlists/${setlist.id}/move`, { data: { kind: "entry", id: entries[0].id, section_id: null, previous: entries[1].id } }),
      contexts[1]!.request.put(`/api/setlists/${setlist.id}/move`, { data: { kind: "entry", id: entries[1].id, section_id: null, previous: entries[0].id } }),
    ])
    expect(eachOther.every((response) => response.ok())).toBe(true)
    const first = await contexts[0]!.request.put(`/api/setlists/${setlist.id}/move`, { data: { kind: "entry", id: entries[0].id, section_id: null, previous: null } })
    expect(first.ok()).toBe(true)
    const second = await contexts[1]!.request.put(`/api/setlists/${setlist.id}/move`, { data: { kind: "entry", id: entries[0].id, section_id: null, previous: entries[3].id } })
    expect(second.ok()).toBe(true)
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})

test("parallel adds get distinct keys and a following move lands after its anchor", async ({ page, testing }) => {
  await testing.login()
  const band = await (await page.request.post("/api/my/bands", { data: { slug: `test-parallel-add-${Date.now()}`, name: "Parallel adds" } })).json()
  const song = await (await page.request.post("/api/songs", { data: { band_id: band.id, title: "Song", artist: null, key: null, tempo_bpm: null, duration_seconds: null, capo: null, notes: null } })).json()
  const setlist = await (await page.request.post("/api/setlists", { data: { band_id: band.id, name: "Adds", description: null, gig_date: null, status: "draft" } })).json()
  const responses = await Promise.all(Array.from({ length: 4 }, () => page.request.post(`/api/setlists/${setlist.id}/entries`, { data: { song_id: song.id } })))
  expect(responses.every((response) => response.ok())).toBe(true)
  const added = await Promise.all(responses.map((response) => response.json()))
  expect(new Set(added.map((entry: { position_key: string }) => entry.position_key)).size).toBe(4)
  const moved = await page.request.put(`/api/setlists/${setlist.id}/move`, { data: { kind: "entry", id: added[3].id, section_id: null, previous: added[0].id } })
  expect(moved.ok()).toBe(true)
  const entries = await (await page.request.get(`/api/setlists/${setlist.id}/entries`)).json()
  const anchorIndex = entries.findIndex((entry: { id: string }) => entry.id === added[0].id)
  expect(entries[anchorIndex + 1]!.id).toBe(added[3].id)
})

test("rebalances entry and section keys after repeated neighbour moves", async ({ page, testing }) => {
  test.setTimeout(60_000)
  await testing.login()
  const band = await (await page.request.post("/api/my/bands", { data: { slug: `test-rebalance-${Date.now()}`, name: "Rebalance" } })).json()
  const songs = []
  for (const title of ["Alpha", "Beta", "Gamma"]) songs.push(await (await page.request.post("/api/songs", { data: { band_id: band.id, title, artist: null, key: null, tempo_bpm: null, duration_seconds: null, capo: null, notes: null } })).json())
  const setlist = await (await page.request.post("/api/setlists", { data: { band_id: band.id, name: "Rebalance", description: null, gig_date: null, status: "draft" } })).json()
  const entries = []
  for (const song of songs) entries.push(await (await page.request.post(`/api/setlists/${setlist.id}/entries`, { data: { song_id: song.id } })).json())
  const sections = []
  for (const name of ["Set 1", "Set 2", "Set 3"]) sections.push(await (await page.request.post(`/api/setlists/${setlist.id}/sections`, { data: { name } })).json())
  const move = async (kind: "entry" | "section", id: string, previous: string) => {
    const response = await page.request.put(`/api/setlists/${setlist.id}/move`, { data: kind === "entry" ? { kind, id, section_id: null, previous } : { kind, id, previous } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  for (let index = 0; index < 100; index += 1) {
    await move("entry", entries[0].id, entries[1].id)
    await move("entry", entries[1].id, entries[0].id)
    await move("section", sections[0].id, sections[1].id)
    await move("section", sections[1].id, sections[0].id)
  }
  const finalEntries = await (await page.request.get(`/api/setlists/${setlist.id}/entries`)).json()
  expect(finalEntries.map((entry: { id: string }) => entry.id)).toEqual(entries.map((entry: { id: string }) => entry.id))
  expect(Math.max(...finalEntries.map((entry: { position_key: string }) => entry.position_key.length))).toBeLessThanOrEqual(32)
  const finalSections = await (await page.request.get(`/api/setlists/${setlist.id}/sections`)).json()
  expect(finalSections.map((section: { id: string }) => section.id)).toEqual(sections.map((section: { id: string }) => section.id))
  expect(Math.max(...finalSections.map((section: { position_key: string }) => section.position_key.length))).toBeLessThanOrEqual(32)
})
