import { describe, expect, test } from "bun:test"
import { createBuiltinAgents } from "../../../src/agents/builtin-agents"
import { BuiltinAgentNameSchema, MatrixxConfigSchema } from "../../../src/config/schema"
import { AGENT_DISPLAY_NAMES } from "../../../src/shared/agent-display-names"
import { getAgentModelRequirements } from "../../../src/shared"
import { evaluate, type PermissionInput } from "./permission-eval"

const build = (disabled: string[] = [], overrides: Record<string, unknown> = {}) =>
  createBuiltinAgents(disabled, overrides as never, process.cwd(), "anthropic/claude-sonnet-4-6") as Promise<Record<string, Record<string, any>>>

describe("tank registration", () => {
  test("is built by createBuiltinAgents as a callable (non-primary) subagent", async () => {
    //#when
    const agents = await build()
    //#then
    expect(agents.tank).toBeDefined()
    expect(agents.tank.mode).toBe("subagent")
    expect(agents.tank.model).toBeTruthy()
  })

  test("agents.tank.model in the plugin config sets its model", async () => {
    //#when
    const agents = await build([], { tank: { model: "anthropic/claude-opus-4-6" } })
    //#then
    expect(agents.tank.model).toBe("anthropic/claude-opus-4-6")
  })

  test("a model-only override does not wipe the permission rules", async () => {
    //#when
    const agents = await build([], { tank: { model: "anthropic/claude-opus-4-6" } })
    const permission = agents.tank.permission as PermissionInput
    //#then the test-only edit rule and the audit ban survive the deep merge
    expect(evaluate(permission, "edit", "src/app.ts")).toBe("deny")
    expect(evaluate(permission, "edit", "src/app.test.ts")).toBe("allow")
    expect(evaluate(permission, "bash", "npm audit")).toBe("deny")
  })

  test("the consumer's config shape parses: agents.tank.model", () => {
    //#when
    const parsed = MatrixxConfigSchema.safeParse({ agents: { tank: { model: "anthropic/claude-sonnet-4-6" } } })
    //#then
    expect(parsed.success).toBe(true)
  })

  test("disabled_agents accepts and removes it", async () => {
    //#then
    expect(MatrixxConfigSchema.safeParse({ disabled_agents: ["tank"] }).success).toBe(true)
    expect(await build(["tank"])).not.toHaveProperty("tank")
  })

  test("is advertised to Morpheus so it can delegate to it", async () => {
    //#when
    const agents = await build()
    //#then it is in the key triggers, the tool-selection table and the delegation table
    const prompt = String(agents.morpheus?.prompt)
    expect(prompt).toContain("fire `tank`")
    expect(prompt).toContain("| `tank` agent |")
    expect(prompt).toContain("| Regression Validation | `tank` |")
  })

  test("has a schema name, display name, and fallback chain", () => {
    //#then
    expect(BuiltinAgentNameSchema.options).toContain("tank")
    expect(AGENT_DISPLAY_NAMES.tank).toBeDefined()
    expect(getAgentModelRequirements().tank?.fallbackChain.length).toBeGreaterThan(0)
  })

  test("still builds alongside cyclopt (no name collision)", async () => {
    //#when
    const agents = await build()
    //#then
    expect(agents.cyclopt).toBeDefined()
    expect(agents.tank).toBeDefined()
  })
})
