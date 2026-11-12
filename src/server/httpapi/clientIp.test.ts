import { describe, expect, test } from "bun:test"
import { networkOf } from "./clientIp"

describe("networkOf", () => {
  test("keeps an IPv4 address whole", () => {
    expect(networkOf("203.0.113.7")).toBe("203.0.113.7")
  })

  test("reads an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(networkOf("::ffff:203.0.113.7")).toBe("203.0.113.7")
  })

  test("maps every address in one /64 to the same key", () => {
    const a = networkOf("2001:db8:1:2::1")
    expect(networkOf("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(a)
    expect(networkOf("2001:0DB8:0001:0002:0:0:0:9")).toBe(a)
  })

  test("tells two /64 networks apart", () => {
    expect(networkOf("2001:db8:1:2::1")).not.toBe(networkOf("2001:db8:1:3::1"))
  })

  test("fills in a leading and a trailing `::`", () => {
    expect(networkOf("::1")).toBe("0:0:0:0")
    expect(networkOf("fe80::")).toBe("fe80:0:0:0")
  })
})
