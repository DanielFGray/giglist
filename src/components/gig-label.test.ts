import { describe, expect, it } from "bun:test"
import { gigLabel, splitGigs } from "./gig-label"

describe("gigLabel", () => {
  it("names a gig by its venue", () => {
    expect(gigLabel({ venue: "The Echo Room", gig_date: "2026-11-07" })).toBe("The Echo Room")
  })

  it("falls back to the gig date, without shifting the day", () => {
    expect(gigLabel({ venue: null, gig_date: "2026-11-07" }, "en-US")).toBe("Sat, Nov 7, 2026")
  })

  it("says when there is neither", () => {
    expect(gigLabel({ venue: null, gig_date: null })).toBe("Undated gig")
  })
})

describe("splitGigs", () => {
  const gig = (gig_date: string | null) => ({ gig_date })
  it("lists upcoming gigs soonest first, undated ones after, and past ones latest first", () => {
    const { upcoming, past } = splitGigs([gig("2026-01-01"), gig(null), gig("2026-12-01"), gig("2026-10-19"), gig("2025-05-05")], "2026-10-19")
    expect(upcoming.map((g) => g.gig_date)).toEqual(["2026-10-19", "2026-12-01", null])
    expect(past.map((g) => g.gig_date)).toEqual(["2026-01-01", "2025-05-05"])
  })
})
