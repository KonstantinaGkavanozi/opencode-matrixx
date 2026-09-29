import { describe, expect, test } from "bun:test"
import { CycloptConfigSchema, MatrixxConfigSchema, ToolGatingConfigSchema } from "../../src/config/schema"
import { shouldEnableCycloptTools } from "../../src/plugin/tool-gating"

describe("CycloptConfigSchema", () => {
  test("provides safe defaults", () => {
    //#when
    const cfg = CycloptConfigSchema.parse({})
    //#then
    expect(cfg.poll_interval_ms).toBeGreaterThanOrEqual(10_000)
    expect(cfg.default_analyzers).toEqual(["metrics", "violations", "sast"])
    expect(cfg.job_timeout_ms).toBeGreaterThan(cfg.poll_interval_ms)
  })

  test("allow_fix_code defaults to false and accepts true", () => {
    //#then
    expect(CycloptConfigSchema.parse({}).allow_fix_code).toBe(false)
    expect(CycloptConfigSchema.parse({ allow_fix_code: true }).allow_fix_code).toBe(true)
    expect(CycloptConfigSchema.safeParse({ allow_fix_code: "yes" }).success).toBe(false)
  })

  test("rejects a poll interval below the server's 10s floor", () => {
    //#then
    expect(CycloptConfigSchema.safeParse({ poll_interval_ms: 9_999 }).success).toBe(false)
    expect(CycloptConfigSchema.safeParse({ poll_interval_ms: 10_000 }).success).toBe(true)
  })

  test("rejects unknown analyzers and bad urls", () => {
    //#then
    expect(CycloptConfigSchema.safeParse({ default_analyzers: ["nope"] }).success).toBe(false)
    expect(CycloptConfigSchema.safeParse({ base_url: "not a url" }).success).toBe(false)
  })

  test("has no field that could carry the token", () => {
    //#then
    expect(Object.keys(CycloptConfigSchema.shape)).not.toContain("token")
    expect(Object.keys(CycloptConfigSchema.shape)).not.toContain("api_key")
  })

  test("is accepted at the top level of the plugin config, with agent override and gating", () => {
    //#when
    const parsed = MatrixxConfigSchema.safeParse({
      cyclopt: { max_batch_files: 10 },
      agents: { cyclopt: { model: "anthropic/claude-sonnet-4-6" } },
      disabled_agents: ["cyclopt"],
      tool_gating: { cyclopt_tools: true },
    })
    //#then
    expect(parsed.success).toBe(true)
    expect(ToolGatingConfigSchema.parse({}).cyclopt_tools).toBeUndefined()
  })
})

describe("shouldEnableCycloptTools", () => {
  test("auto-enables only when a token exists", () => {
    //#then
    expect(shouldEnableCycloptTools(true, undefined)).toBe(true)
    expect(shouldEnableCycloptTools(false, undefined)).toBe(false)
  })

  test("explicit override wins in both directions", () => {
    //#then
    expect(shouldEnableCycloptTools(false, true)).toBe(true)
    expect(shouldEnableCycloptTools(true, false)).toBe(false)
  })
})
