import { describe, expect, test } from "bun:test"
import fixture from "./fixtures/completed-javascript.json"
import { normalizeEnvelope, normalizeSeverity, remapPath } from "../../../src/tools/cyclopt-scan/result-normalizer"
import type { JobEnvelope } from "../../../src/tools/cyclopt-scan/types"

const known = new Set(["probe.js"])

describe("remapPath", () => {
  test("maps a sandbox-root-relative path to the sent filename", () => {
    //#given a leading-slash path as Cyclopt returns it
    //#when
    const result = remapPath("/probe.js", known)
    //#then
    expect(result).toEqual({ file: "probe.js", unmapped: false })
  })

  test("maps a full ephemeral sandbox path by longest matching suffix", () => {
    //#given
    const raw = "/tmp/sandbox-outer/sandbox-inner/src/a/b.ts"
    //#when
    const result = remapPath(raw, new Set(["src/a/b.ts", "b.ts"]))
    //#then the longest suffix wins over the bare basename
    expect(result).toEqual({ file: "src/a/b.ts", unmapped: false })
  })

  test("maps a bare basename only when unambiguous", () => {
    //#given
    const ambiguous = new Set(["src/x.ts", "lib/x.ts"])
    //#then
    expect(remapPath("x.ts", ambiguous).unmapped).toBe(true)
    expect(remapPath("x.ts", new Set(["src/x.ts"]))).toEqual({ file: "src/x.ts", unmapped: false })
  })

  test("surfaces unknown paths as unmapped instead of guessing", () => {
    //#when
    const result = remapPath("/tmp/abc/other.js", known)
    //#then
    expect(result.unmapped).toBe(true)
  })

  test("handles windows separators", () => {
    //#then
    expect(remapPath("\\probe.js", known).file).toBe("probe.js")
  })
})

describe("normalizeSeverity", () => {
  test("normalises Cyclopt's capitalised vocabulary", () => {
    //#then
    expect(normalizeSeverity("Critical")).toBe("critical")
    expect(normalizeSeverity("Major")).toBe("major")
    expect(normalizeSeverity("Minor")).toBe("minor")
    expect(normalizeSeverity(undefined)).toBe("info")
  })

  test("maps common scanner vocabularies", () => {
    //#then
    expect(normalizeSeverity("HIGH")).toBe("critical")
    expect(normalizeSeverity("medium")).toBe("major")
    expect(normalizeSeverity("low")).toBe("minor")
  })
})

describe("normalizeEnvelope against the recorded live response", () => {
  const norm = normalizeEnvelope(fixture as unknown as JobEnvelope, known)

  test("flattens the rule-keyed map into one finding per occurrence", () => {
    //#given 3 unused-var occurrences + 1 no-undef occurrence
    const violations = norm.findings.filter((f) => f.analyzer === "violations")
    //#then
    expect(violations).toHaveLength(4)
    expect(violations.filter((f) => f.rule === "ESLINT_no-unused-vars").map((f) => f.line)).toEqual([1, 2, 3])
  })

  test("remaps every path to a repo-relative filename", () => {
    //#then
    expect(norm.findings.every((f) => f.file === "probe.js" && !f.unmapped)).toBe(true)
  })

  test("normalises severity but preserves the raw value", () => {
    //#given
    const f = norm.findings.find((x) => x.rule === "ESLINT_no-undef")
    //#then
    expect(f?.severity).toBe("major")
    expect(f?.severityRaw).toBe("Major")
  })

  test("carries title and category through", () => {
    //#given
    const f = norm.findings.find((x) => x.rule === "ESLINT_no-undef")
    //#then
    expect(f?.title).toBe("Disallow Undeclared Variables")
    expect(f?.category).toBe("Best Practices")
  })

  test("emits an info finding for a flagged metric but not for empty ones", () => {
    //#given
    const metric = norm.findings.filter((f) => f.analyzer === "metrics")
    //#then only CD listed a file
    expect(metric).toHaveLength(1)
    expect(metric[0]?.rule).toBe("metric:CD")
    expect(metric[0]?.severity).toBe("info")
  })

  test("reports no SAST findings when the sast array is empty", () => {
    //#then
    expect(norm.findings.filter((f) => f.analyzer === "sast")).toHaveLength(0)
  })

  test("captures metrics values and normalised scores per language", () => {
    //#given
    const merged = Object.assign({}, ...norm.metrics.map((m) => m.scores))
    //#then
    expect(norm.metrics.some((m) => m.language === "javascript" && m.values.MI === 128.06)).toBe(true)
    expect(merged.ESCOMP_MI).toEqual({ avgValue: 128.06, avgScore: 0.73 })
    expect(merged.ESLINT_ERR.avgScore).toBe(0.95)
  })

  test("reports no language problems when every language completed", () => {
    //#then
    expect(norm.languageProblems).toEqual([])
  })
})

describe("normalizeEnvelope edge cases", () => {
  test("flags a language that failed even though the job completed", () => {
    //#given
    const envelope: JobEnvelope = {
      status: "completed",
      languageStatus: { javascript: "completed", python: "failed" },
      results: { javascript: {} },
    }
    //#when
    const norm = normalizeEnvelope(envelope, known)
    //#then
    expect(norm.languageProblems).toEqual([{ language: "python", status: "failed" }])
  })

  test("merges findings across multiple languages", () => {
    //#given two language trees
    const one = (rule: string) => ({
      violations: { violations: { info: { violations: { [rule]: { files: [{ filePath: "/a", line: 1 }], severity: "Minor", title: rule } } } } },
    })
    const envelope: JobEnvelope = { status: "completed", results: { javascript: one("R1"), python: one("R2") } }
    //#when
    const norm = normalizeEnvelope(envelope, new Set(["a"]))
    //#then
    expect(norm.findings.map((f) => `${f.language}:${f.rule}`).sort()).toEqual(["javascript:R1", "python:R2"])
  })

  test("extracts unverified analyzers best-effort and marks them", () => {
    //#given an unknown duplication shape
    const envelope: JobEnvelope = {
      status: "completed",
      results: { javascript: { duplication: { duplicates: [{ file: "a.js", startLine: 3, description: "dup block", severity: "Major" }] } } },
    }
    //#when
    const norm = normalizeEnvelope(envelope, new Set(["a.js"]))
    //#then
    expect(norm.findings).toHaveLength(1)
    expect(norm.findings[0]).toMatchObject({ analyzer: "duplication", file: "a.js", line: 3, severity: "major", bestEffort: true })
  })

  test("never throws on an empty or malformed envelope", () => {
    //#then
    expect(normalizeEnvelope({}, known).findings).toEqual([])
    expect(normalizeEnvelope({ results: { js: { sast: "garbage" as unknown as Record<string, unknown> } } }, known).findings).toEqual([])
  })
})
