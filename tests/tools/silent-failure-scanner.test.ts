/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createSilentFailureScannerTool } from "../../src/tools/silent-failure-scanner"

const FIXTURES = join(import.meta.dir, "..", "fixtures", "silent-failure-scanner")

type Finding = { rule: string; severity: string; file: string; line: number }
type ScanResult = { status: 0 | 1 | 2; findings: Finding[]; summary: { total: number } }

function scanner() {
  return createSilentFailureScannerTool({ directory: FIXTURES } as unknown as PluginInput)
}

async function scan(args: Record<string, unknown>): Promise<ScanResult> {
  const tool = scanner().silent_failure_scan
  const output = await tool.execute(args)
  return JSON.parse(output) as ScanResult
}

describe("silent_failure_scan", () => {
  describe("Python scanning", () => {
    test("flags silent-failure anti-patterns in a dirty file", async () => {
      //#given a Python file with bare except/pass, log-then-default, bare gather, indexed gather, and gap-masking flag
      //#when the scanner runs over the file
      const result = await scan({ path: "bad.py" })

      //#then every rule fires and the exit status is errors
      const rules = new Set(result.findings.map((f) => f.rule))
      expect(rules.has("SF001")).toBe(true)
      expect(rules.has("SF002")).toBe(true)
      expect(rules.has("SF003")).toBe(true)
      expect(rules.has("SF004")).toBe(true)
      expect(rules.has("SF005")).toBe(true)
      expect(result.status).toBe(2)
    })

    test("does not flag a clean Python file", async () => {
      //#given a Python file that re-raises and inspects gather results
      //#when the scanner runs over the file
      const result = await scan({ path: "clean.py" })

      //#then no findings and a clean status
      expect(result.findings).toHaveLength(0)
      expect(result.status).toBe(0)
    })

    test("reports line numbers pointing at the offending construct", async () => {
      //#given the dirty fixture
      //#when the scanner runs
      const result = await scan({ path: "bad.py" })
      const sf001 = result.findings.find((f) => f.rule === "SF001")

      //#then the bare except is located on its source line
      expect(sf001).toBeDefined()
      expect(sf001?.line).toBe(10)
    })

    test("severity=error filters warnings out of the report", async () => {
      //#given the dirty fixture and an error-only threshold
      //#when the scanner runs
      const result = await scan({ path: "bad.py", severity: "error" })

      //#then only error-severity rules remain
      expect(result.findings.length).toBeGreaterThan(0)
      expect(result.findings.every((f) => f.severity === "error")).toBe(true)
      expect(result.findings.some((f) => f.rule === "SF002")).toBe(false)
    })
  })

  describe("TypeScript scanning", () => {
    test("flags an empty catch block", async () => {
      //#given a TS file with `catch {}`
      //#when the scanner runs
      const result = await scan({ path: "bad.ts" })

      //#then SF001 fires with error status
      expect(result.findings.some((f) => f.rule === "SF001")).toBe(true)
      expect(result.status).toBe(2)
    })

    test("does not flag a re-throwing catch", async () => {
      //#given a TS file that re-throws
      //#when the scanner runs
      const result = await scan({ path: "clean.ts" })

      //#then no findings
      expect(result.findings).toHaveLength(0)
    })
  })
})
