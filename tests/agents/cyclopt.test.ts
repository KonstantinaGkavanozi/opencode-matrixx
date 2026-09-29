import { describe, expect, test } from "bun:test"
import { CYCLOPT_ALLOWED_TOOLS, CYCLOPT_PROMPT_METADATA, createCycloptAgent } from "../../src/agents/cyclopt"
import { BuiltinAgentNameSchema } from "../../src/config/schema"
import { AGENT_DISPLAY_NAMES } from "../../src/shared/agent-display-names"
import { getAgentModelRequirements } from "../../src/shared"

describe("createCycloptAgent", () => {
  const agent = createCycloptAgent("anthropic/claude-sonnet-4-6") as Record<string, any>

  test("is a low-temperature read-only specialist", () => {
    //#then
    expect(agent.temperature).toBe(0.1)
    expect(agent.mode).toBe("all")
    expect(createCycloptAgent.mode).toBe("all")
  })

  test("denies everything by default, including write, edit, bash and delegation", () => {
    //#then
    expect(agent.permission["*"]).toBe("deny")
    for (const t of ["write", "edit", "multiedit", "bash", "task"]) expect(agent.permission[t]).toBeUndefined()
  })

  test("report-only: fix_code and check_fix_job are unreachable in either MCP naming form", () => {
    //#then
    const names = Object.keys(agent.permission).join(" ")
    expect(names).not.toContain("fix_code")
    expect(names).not.toContain("check_fix_job")
    expect(names).not.toContain("check_fix_usage")
    expect(CYCLOPT_ALLOWED_TOOLS.some((t) => t.includes("fix"))).toBe(false)
  })

  test("allows its own scan tools and the raw analysis tools, in both naming forms", () => {
    //#then
    for (const t of ["read", "grep", "glob", "cyclopt_scan", "cyclopt_job_status", "cyclopt_analyze_sast", "cyclopt__analyze_sast", "cyclopt_check_analysis_job", "cyclopt__check_analysis_job"]) {
      expect(agent.permission[t]).toBe("allow")
    }
  })

  test("never uses a cyclopt wildcard that would re-admit fix_code", () => {
    //#then
    expect(Object.keys(agent.permission).some((k) => k.includes("*") && k !== "*")).toBe(false)
  })

  test("the prompt encodes the server's no-inference contract", () => {
    //#then
    expect(agent.prompt).toContain("MUST NOT produce findings")
    expect(agent.prompt).toContain("NEVER substitute your own analysis")
    expect(agent.prompt).toContain("job_id")
    expect(agent.prompt).toContain("NOT \"the code is secure")
    expect(agent.prompt).toContain("Sentinel")
    expect(agent.prompt).toContain("CYCLOPT_API_TOKEN")
  })

  test("Claude models get extended thinking; GPT models get reasoning effort", () => {
    //#given
    const gpt = createCycloptAgent("openai/gpt-5.2") as Record<string, any>
    //#then
    expect(agent.thinking).toEqual({ type: "enabled", budgetTokens: 8000 })
    expect(gpt.reasoningEffort).toBe("medium")
    expect(gpt.thinking).toBeUndefined()
  })
})

describe("cyclopt registration", () => {
  test("is a valid builtin agent name with a display name and fallback chain", () => {
    //#then
    expect(BuiltinAgentNameSchema.options).toContain("cyclopt")
    expect(AGENT_DISPLAY_NAMES.cyclopt).toBeDefined()
    expect(getAgentModelRequirements().cyclopt?.fallbackChain.length).toBeGreaterThan(0)
  })

  test("metadata routes Morpheus and separates Cyclopt from Sentinel", () => {
    //#then
    expect(CYCLOPT_PROMPT_METADATA.keyTrigger).toContain("fire `cyclopt`")
    expect(CYCLOPT_PROMPT_METADATA.avoidWhen?.join(" ")).toContain("Sentinel")
  })
})
