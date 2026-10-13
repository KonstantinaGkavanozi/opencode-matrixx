import { describe, expect, test } from "bun:test"
import { createTankAgent } from "../../src/agents/tank"
import { applyToolConfig } from "../../src/plugin-handlers/tool-config-handler"
import { evaluate, isHidden, type PermissionInput } from "../agents/tank/permission-eval"

/** The config hook rewrites every agent's permission; tank's path/command rules must survive it. */
describe("tank permission after applyToolConfig", () => {
  const run = () => {
    const agentResult = { tank: createTankAgent("anthropic/claude-sonnet-4-6") } as Record<string, unknown>
    applyToolConfig({ config: {}, pluginConfig: {} as never, agentResult })
    return (agentResult.tank as { permission: PermissionInput }).permission
  }

  test("keeps the nested edit and bash rules intact", () => {
    //#when
    const permission = run()
    //#then
    expect(evaluate(permission, "edit", "src/app.ts")).toBe("deny")
    expect(evaluate(permission, "edit", "src/app.test.ts")).toBe("allow")
    expect(evaluate(permission, "edit", "tests/package.json")).toBe("deny")
    expect(evaluate(permission, "bash", "npm audit --json")).toBe("deny")
    expect(evaluate(permission, "bash", "npm test")).toBe("allow")
  })

  test("still hides delegation, questions and every Cyclopt tool including the fixer", () => {
    //#when
    const permission = run()
    //#then
    for (const tool of ["task", "question", "cyclopt_scan", "cyclopt_analyze_sast", "cyclopt_fix_code", "cyclopt__fix_code"]) {
      expect(isHidden(permission, tool)).toBe(true)
    }
  })
})
