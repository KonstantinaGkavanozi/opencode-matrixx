import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createCycloptConfig } from "../../src/mcp/cyclopt"
import { CYCLOPT_DEFAULT_BASE_URL, hasCycloptToken, resolveCycloptEndpoint } from "../../src/mcp/cyclopt-endpoint"
import { createBuiltinMcps } from "../../src/mcp/index"

let original: string | undefined
beforeEach(() => {
  original = process.env.CYCLOPT_API_TOKEN
  delete process.env.CYCLOPT_API_TOKEN
})
afterEach(() => {
  if (original === undefined) delete process.env.CYCLOPT_API_TOKEN
  else process.env.CYCLOPT_API_TOKEN = original
})

describe("resolveCycloptEndpoint", () => {
  test("fails with actionable error when token is unset", () => {
    //#given no token
    //#when
    const result = resolveCycloptEndpoint()
    //#then
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("CYCLOPT_API_TOKEN")
  })

  test("treats a whitespace-only token as unset", () => {
    //#given
    process.env.CYCLOPT_API_TOKEN = "   "
    //#then
    expect(resolveCycloptEndpoint().ok).toBe(false)
    expect(hasCycloptToken()).toBe(false)
  })

  test("uses default base url and trims token", () => {
    //#given
    process.env.CYCLOPT_API_TOKEN = " tok "
    //#when
    const result = resolveCycloptEndpoint()
    //#then
    expect(result).toEqual({ ok: true, endpoint: { baseUrl: CYCLOPT_DEFAULT_BASE_URL, token: "tok" } })
  })

  test("honours a configured base url", () => {
    //#given
    process.env.CYCLOPT_API_TOKEN = "tok"
    //#when
    const result = resolveCycloptEndpoint({ base_url: "https://example.test/mcp" })
    //#then
    expect(result.ok && result.endpoint.baseUrl).toBe("https://example.test/mcp")
  })
})

describe("config-file credential (global, user-level)", () => {
  test("resolves the token from cyclopt.api_token when no env var is set", () => {
    //#when
    const result = resolveCycloptEndpoint({ api_token: " cfg-tok " })
    //#then
    expect(result.ok && result.endpoint.token).toBe("cfg-tok")
    expect(hasCycloptToken({ api_token: "cfg-tok" })).toBe(true)
  })

  test("the env var takes precedence over the config token", () => {
    //#given
    process.env.CYCLOPT_API_TOKEN = "env-tok"
    //#when
    const result = resolveCycloptEndpoint({ api_token: "cfg-tok" })
    //#then
    expect(result.ok && result.endpoint.token).toBe("env-tok")
  })

  test("a blank config token does not count", () => {
    //#then
    expect(hasCycloptToken({ api_token: "   " })).toBe(false)
    expect(resolveCycloptEndpoint({ api_token: "" }).ok).toBe(false)
  })

  test("the error tells the user where to put the token", () => {
    //#when
    const result = resolveCycloptEndpoint()
    //#then
    expect(!result.ok && result.error).toContain("matrixx.jsonc")
  })

  test("createBuiltinMcps registers the MCP from the config token alone", () => {
    //#when
    const { mcps, failures } = createBuiltinMcps([], { cyclopt: { api_token: "cfg-tok" } } as never, { isCommandAvailable: () => true })
    //#then
    expect(mcps.cyclopt).toMatchObject({ enabled: true, headers: { Authorization: "Bearer cfg-tok" } })
    expect(failures).toHaveLength(0)
  })
})

describe("createCycloptConfig", () => {
  test("builds a remote config with bearer auth", () => {
    //#given
    process.env.CYCLOPT_API_TOKEN = "tok"
    //#when
    const cfg = createCycloptConfig()
    //#then
    expect(cfg).toEqual({
      type: "remote",
      url: CYCLOPT_DEFAULT_BASE_URL,
      enabled: true,
      headers: { Authorization: "Bearer tok" },
      oauth: false,
    })
  })

  test("throws without a token", () => {
    //#then
    expect(() => createCycloptConfig()).toThrow("CYCLOPT_API_TOKEN")
  })
})

describe("createBuiltinMcps — cyclopt", () => {
  const opts = { isCommandAvailable: () => true }

  test("is skipped silently when no token is set", () => {
    //#when
    const { mcps, failures } = createBuiltinMcps([], undefined, opts)
    //#then
    expect(mcps).not.toHaveProperty("cyclopt")
    expect(failures).toHaveLength(0)
  })

  test("is registered when the token is set", () => {
    //#given
    process.env.CYCLOPT_API_TOKEN = "tok"
    //#when
    const { mcps, failures } = createBuiltinMcps([], undefined, opts)
    //#then
    expect(mcps.cyclopt).toMatchObject({ type: "remote", enabled: true })
    expect(failures).toHaveLength(0)
  })

  test("respects disabled_mcps", () => {
    //#given
    process.env.CYCLOPT_API_TOKEN = "tok"
    //#when
    const { mcps } = createBuiltinMcps(["cyclopt"], undefined, opts)
    //#then
    expect(mcps).not.toHaveProperty("cyclopt")
  })

  test("reads the token lazily, not at creation time", () => {
    //#given a token present at creation
    process.env.CYCLOPT_API_TOKEN = "tok"
    const { mcps, failures } = createBuiltinMcps([], undefined, opts)
    //#when the token vanishes before first access
    delete process.env.CYCLOPT_API_TOKEN
    const cfg = mcps.cyclopt
    //#then it degrades to a disabled stub and records why
    expect(cfg).toMatchObject({ enabled: false })
    expect(failures.some((f) => f.name === "cyclopt")).toBe(true)
  })
})
