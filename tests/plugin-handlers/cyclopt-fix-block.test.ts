import { describe, expect, test } from "bun:test"
import { CYCLOPT_BLOCKED_TOOLS } from "../../src/mcp/cyclopt-blocked-tools"
import { applyToolConfig } from "../../src/plugin-handlers/tool-config-handler"

const run = (config: Record<string, unknown>, agentResult: Record<string, unknown>, pluginConfig: unknown = {}) => {
  applyToolConfig({ config, pluginConfig: pluginConfig as never, agentResult })
  return { config, agentResult }
}

describe("cyclopt code-fixer block", () => {
  test("covers fix_code, check_fix_job and check_fix_usage in both MCP naming forms", () => {
    //#then
    for (const name of ["fix_code", "check_fix_job", "check_fix_usage"]) {
      expect(CYCLOPT_BLOCKED_TOOLS).toContain(`cyclopt_${name}`)
      expect(CYCLOPT_BLOCKED_TOOLS).toContain(`cyclopt__${name}`)
    }
  })

  test("never blocks the analysis tools", () => {
    //#then
    expect(CYCLOPT_BLOCKED_TOOLS.some((t) => t.includes("analy") || t.includes("list_analyzers"))).toBe(false)
  })

  test("denies the fixer globally, both as a permission and via the legacy tools switch", () => {
    //#when
    const { config } = run({}, {})
    //#then
    const permission = config.permission as Record<string, unknown>
    const tools = config.tools as Record<string, unknown>
    for (const tool of CYCLOPT_BLOCKED_TOOLS) {
      expect(permission[tool]).toBe("deny")
      expect(tools[tool]).toBe(false)
    }
  })

  test("preserves unrelated global permissions and tools", () => {
    //#when
    const { config } = run({ permission: { bash: "ask" }, tools: { custom: true } }, {})
    //#then
    expect((config.permission as Record<string, unknown>).bash).toBe("ask")
    expect((config.tools as Record<string, unknown>).custom).toBe(true)
  })

  test("denies it on every agent, including ones that explicitly allowed it", () => {
    //#given an agent that tries to allow the fixer
    const { agentResult } = run({}, { morpheus: { permission: { cyclopt_fix_code: "allow", bash: "allow" } }, mouse: {} })
    //#then
    for (const name of ["morpheus", "mouse"]) {
      const permission = (agentResult[name] as { permission: Record<string, unknown> }).permission
      for (const tool of CYCLOPT_BLOCKED_TOOLS) expect(permission[tool]).toBe("deny")
    }
    expect((agentResult.morpheus as { permission: Record<string, unknown> }).permission.bash).toBe("allow")
  })

  test("the deny rules come last so last-match-wins cannot be overridden by an earlier allow", () => {
    //#given a wildcard allow placed after nothing, then the block
    const { agentResult } = run({}, { keymaker: { permission: { "*": "allow" } } })
    //#then
    const keys = Object.keys((agentResult.keymaker as { permission: Record<string, unknown> }).permission)
    expect(keys.indexOf("cyclopt_fix_code")).toBeGreaterThan(keys.indexOf("*"))
  })

  test("cyclopt.allow_fix_code=true stops the block and leaves permissions untouched", () => {
    //#given the user opted in
    const { config, agentResult } = run({}, { morpheus: { permission: {} } }, { cyclopt: { allow_fix_code: true } })
    //#then no fixer rule is added anywhere
    const permission = config.permission as Record<string, unknown>
    const tools = config.tools as Record<string, unknown>
    const morpheus = (agentResult.morpheus as { permission: Record<string, unknown> }).permission
    for (const tool of CYCLOPT_BLOCKED_TOOLS) {
      expect(permission[tool]).toBeUndefined()
      expect(tools[tool]).toBeUndefined()
      expect(morpheus[tool]).toBeUndefined()
    }
  })

  test("allow_fix_code=false and an absent setting both keep the block", () => {
    //#then
    for (const pluginConfig of [{ cyclopt: { allow_fix_code: false } }, { cyclopt: {} }, {}]) {
      const { config } = run({}, {}, pluginConfig)
      expect((config.permission as Record<string, unknown>).cyclopt_fix_code).toBe("deny")
    }
  })

  test("the cyclopt agent's own allowlist never grants the fixer, whatever allow_fix_code says", async () => {
    //#given
    const { CYCLOPT_ALLOWED_TOOLS } = await import("../../src/agents/cyclopt")
    //#then
    expect(CYCLOPT_ALLOWED_TOOLS.filter((t) => CYCLOPT_BLOCKED_TOOLS.includes(t))).toEqual([])
  })
})
