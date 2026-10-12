import { describe, expect, test } from "bun:test"
import { createTankAgent, TANK_PROMPT_METADATA } from "../../../src/agents/tank"
import { evaluate, isHidden, type PermissionInput } from "./permission-eval"

const agent = createTankAgent("anthropic/claude-sonnet-4-6") as Record<string, any>
const permission = agent.permission as PermissionInput

describe("tank agent shape", () => {
  test("is a low-temperature subagent that task() can call", () => {
    //#then
    expect(agent.mode).toBe("subagent")
    expect(agent.mode).not.toBe("primary")
    expect(agent.temperature).toBe(0.1)
    expect(createTankAgent.mode).toBe("subagent")
  })

  test("Claude models get bounded thinking; GPT models get reasoning effort", () => {
    //#given
    const gpt = createTankAgent("openai/gpt-5.2") as Record<string, any>
    //#then
    expect(agent.thinking).toEqual({ type: "enabled", budgetTokens: 4000 })
    expect(gpt.reasoningEffort).toBe("medium")
    expect(gpt.thinking).toBeUndefined()
  })

  test("carries the model it is built with", () => {
    //#then
    expect(agent.model).toBe("anthropic/claude-sonnet-4-6")
  })
})

describe("tank edit permission — tests only, enforced by OpenCode not just the prompt", () => {
  const allowed = ["src/foo.test.ts", "a.test.js", "src/util/parse.spec.tsx", "__tests__/x.js", "src/__tests__/x.ts", "tests/helper.ts", "test/unit/a.js", "src/tests/fixtures/data.json"]
  const denied = ["src/foo.ts", "index.js", "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "tsconfig.json", "jest.config.js", ".eslintrc.json", "README.md"]

  test.each(allowed)("allows writing test file %s", (path) => {
    //#then
    expect(evaluate(permission, "edit", path)).toBe("allow")
  })

  test.each(denied)("denies editing non-test file %s", (path) => {
    //#then
    expect(evaluate(permission, "edit", path)).toBe("deny")
  })

  test("never allows node_modules, even inside a tests-looking directory", () => {
    //#then
    for (const p of ["node_modules/x/index.js", "node_modules/x/tests/a.test.js", "packages/a/node_modules/y/__tests__/z.js"]) {
      expect(evaluate(permission, "edit", p)).toBe("deny")
    }
  })

  test("never allows manifests or lockfiles even under a test directory", () => {
    //#then
    for (const p of ["tests/package.json", "tests/package-lock.json", "test/yarn.lock", "tests/pnpm-lock.yaml"]) {
      expect(evaluate(permission, "edit", p)).toBe("deny")
    }
  })

  test("handles Windows path separators", () => {
    //#then
    expect(evaluate(permission, "edit", "src\\foo.test.ts")).toBe("allow")
    expect(evaluate(permission, "edit", "src\\foo.ts")).toBe("deny")
  })

  test("keeps the edit tool visible (path rules, not a blanket deny)", () => {
    //#then
    expect(isHidden(permission, "edit")).toBe(false)
    expect(isHidden(permission, "write")).toBe(false)
  })
})

describe("tank bash permission", () => {
  const allowed = ["npm test", "npm run build", "npm run test -- --coverage", "npm run lint", "npm ci", "npx vitest run src/a.test.ts", "npx jest src/a.test.ts", "node --test", "node -e \"require('x')\"", "yarn test", "pnpm test", "yarn install --frozen-lockfile", "pnpm install --frozen-lockfile", "git status", "git diff", "git stash push -u -m tank", "git stash pop", "grep -rn lodash src", "ls"]
  const denied = ["npm audit", "npm audit --json", "npm audit fix", "yarn audit", "yarn npm audit", "pnpm audit", "npm install", "npm install lodash@4.17.21", "npm i lodash", "npm add x", "npm uninstall x", "npm update", "npm pkg set a=b", "npm version patch", "yarn add x", "pnpm add x", "yarn install", "npm publish", "git push origin main", "git reset --hard", "git clean -fd", "git checkout -- .", "git restore .", "git commit -am x", "git stash drop", "git stash clear", "git apply p.diff", "sed -i s/a/b/ src/a.ts", "perl -pi -e s/a/b/ a.js", "npx eslint --fix .", "npm run lint -- --fix", "npx prettier --write ."]

  test.each(allowed)("allows `%s`", (cmd) => {
    //#then
    expect(evaluate(permission, "bash", cmd)).toBe("allow")
  })

  test.each(denied)("denies `%s`", (cmd) => {
    //#then
    expect(evaluate(permission, "bash", cmd)).toBe("deny")
  })

  test("bash stays visible to the model", () => {
    //#then
    expect(isHidden(permission, "bash")).toBe(false)
  })
})

describe("tank tools hidden entirely", () => {
  test.each(["task", "task_create", "teammate", "question", "cyclopt_scan", "cyclopt_job_status", "cyclopt_analyze_sast", "cyclopt__analyze_sast", "cyclopt_fix_code"])(
    "%s is not visible to tank",
    (tool) => {
      //#then
      expect(isHidden(permission, tool)).toBe(true)
    },
  )

  test("keeps the tools it needs", () => {
    //#then
    for (const tool of ["read", "grep", "glob", "bash", "edit", "write"]) expect(isHidden(permission, tool)).toBe(false)
  })
})

describe("tank prompt contract", () => {
  const prompt = agent.prompt as string

  test("defines the machine-readable verdict line", () => {
    //#then
    expect(prompt).toContain("VERDICT: PASS")
    expect(prompt).toContain("VERDICT: FAIL")
    expect(prompt).toMatch(/first line/i)
  })

  test("states the hard rules from the spec", () => {
    //#then
    expect(prompt).toMatch(/never delete, skip, disable or weaken/i)
    expect(prompt).toContain("@ts-ignore")
    expect(prompt).toContain("eslint-disable")
    expect(prompt).toContain("node_modules")
    expect(prompt).toMatch(/audit/)
    expect(prompt).toContain("@cyclopt/")
    expect(prompt).toMatch(/environmental/i)
    expect(prompt).toMatch(/pre-existing/i)
  })

  test("does not let it act as a fixer or a scanner", () => {
    //#then
    expect(prompt).toMatch(/do not fix/i)
    expect(prompt).toMatch(/not a scanner/i)
  })

  test("explains the stash baseline hazard for dependency bumps", () => {
    //#then
    expect(prompt).toMatch(/node_modules/)
    expect(prompt).toMatch(/git stash pop/)
    expect(prompt).toMatch(/UNVERIFIED/)
  })

  test("supports session continuation", () => {
    //#then
    expect(prompt).toMatch(/same session|continu/i)
  })
})

describe("tank metadata for Morpheus", () => {
  test("routes regression validation and separates it from scanning and fixing", () => {
    //#then
    expect(TANK_PROMPT_METADATA.keyTrigger).toContain("fire `tank`")
    expect(TANK_PROMPT_METADATA.promptAlias).toBe("Tank")
    expect(TANK_PROMPT_METADATA.avoidWhen?.join(" ")).toMatch(/Cyclopt|Sentinel/)
  })
})
