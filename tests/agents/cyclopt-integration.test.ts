import { describe, expect, test } from "bun:test"
import { createBuiltinAgents } from "../../src/agents/builtin-agents"

describe("cyclopt in createBuiltinAgents", () => {
  test("is built with the report-only permission set and a resolved model", async () => {
    //#when
    const agents = (await createBuiltinAgents([], {}, process.cwd(), "anthropic/claude-sonnet-4-6")) as Record<string, Record<string, any>>
    //#then
    expect(agents.cyclopt).toBeDefined()
    expect(agents.cyclopt.model).toBeTruthy()
    expect(agents.cyclopt.permission["*"]).toBe("deny")
    expect(agents.cyclopt.permission.cyclopt_scan).toBe("allow")
  })

  test("is advertised to Morpheus's delegation prompt", async () => {
    //#when
    const agents = (await createBuiltinAgents([], {}, process.cwd(), "anthropic/claude-sonnet-4-6")) as Record<string, Record<string, any>>
    //#then
    expect(String(agents.morpheus?.prompt)).toContain("Cyclopt")
  })

  test("disabled_agents removes it", async () => {
    //#when
    const agents = await createBuiltinAgents(["cyclopt"], {}, process.cwd(), "anthropic/claude-sonnet-4-6")
    //#then
    expect(agents).not.toHaveProperty("cyclopt")
  })

  test("a user model override is honoured", async () => {
    //#when
    const agents = (await createBuiltinAgents([], { cyclopt: { model: "anthropic/claude-opus-4-6" } }, process.cwd(), "anthropic/claude-sonnet-4-6")) as Record<string, Record<string, any>>
    //#then
    expect(agents.cyclopt.model).toBe("anthropic/claude-opus-4-6")
  })
})
