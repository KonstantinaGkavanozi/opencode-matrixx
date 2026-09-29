import { describe, expect, test } from "bun:test"
import fixture from "./fixtures/completed-javascript.json"
import { formatReport } from "../../../src/tools/cyclopt-scan/report-formatter"
import type { EnqueuedJob, JobEnvelope, JobOutcome, ScanReportInput } from "../../../src/tools/cyclopt-scan/types"

const envelope = fixture as unknown as JobEnvelope
const job = (over: Partial<EnqueuedJob> = {}): EnqueuedJob => ({
  jobId: envelope.jobId as string,
  tool: "analyze_file",
  analyzers: ["metrics", "violations", "sast"],
  files: [{ filename: "probe.js", content: "x" }],
  ...over,
})

function report(over: Partial<ScanReportInput> = {}, outcomes?: JobOutcome[]): string {
  const jobs = over.jobs ?? [job()]
  return formatReport({
    scopeLabel: "test scope",
    fileCount: 1,
    skipped: [],
    jobs,
    outcomes: outcomes ?? [{ state: "completed", jobId: jobs[0]?.jobId as string, envelope }],
    enqueueErrors: [],
    ...over,
  })
}

function jsonBlock(text: string): Record<string, any> {
  const m = text.match(/```json cyclopt-findings\n([\s\S]*?)\n```/)
  if (!m) throw new Error("no cyclopt-findings block")
  return JSON.parse(m[1] as string)
}

describe("formatReport", () => {
  test("emits a machine-readable findings block with repo-relative paths", () => {
    //#when
    const data = jsonBlock(report())
    //#then
    expect(data.status).toBe("complete")
    expect(data.counts).toEqual({ critical: 0, major: 4, minor: 0, info: 1 })
    expect(data.findings.every((f: { file: string }) => f.file === "probe.js")).toBe(true)
    expect(data.jobIds).toEqual([envelope.jobId])
  })

  test("orders severities critical → major → minor → info", () => {
    //#when
    const text = report()
    //#then
    expect(text.indexOf("### Major")).toBeGreaterThan(-1)
    expect(text.indexOf("### Major")).toBeLessThan(text.indexOf("### Info"))
  })

  test("includes scores, metrics, elapsed time and language", () => {
    //#when
    const text = report()
    //#then
    expect(text).toContain("ESCOMP_MI")
    expect(text).toContain("3m46s")
    expect(text).toContain("javascript")
  })

  test("applies the severity filter case-insensitively via normalised values", () => {
    //#when
    const data = jsonBlock(report({ severityFilter: ["major"] }))
    //#then
    expect(data.counts).toEqual({ critical: 0, major: 4, minor: 0, info: 0 })
  })

  test("never calls a timed-out scan clean", () => {
    //#when
    const text = report({}, [{ state: "timeout", jobId: envelope.jobId as string }])
    //#then
    expect(jsonBlock(text).status).toBe("failed")
    expect(text).toContain("not a clean result")
    expect(text).toContain("not a full clean bill of health")
  })

  test("marks a mixed outcome as partial and keeps completed findings", () => {
    //#given two jobs, one done and one timed out
    const jobs = [job(), job({ jobId: "j2" })]
    const outcomes: JobOutcome[] = [
      { state: "completed", jobId: envelope.jobId as string, envelope },
      { state: "timeout", jobId: "j2" },
    ]
    //#when
    const data = jsonBlock(report({ jobs }, outcomes))
    //#then
    expect(data.status).toBe("partial")
    expect(data.counts.major).toBe(4)
  })

  test("surfaces failed jobs verbatim", () => {
    //#when
    const text = report({}, [{ state: "failed", jobId: envelope.jobId as string, error: "analyzer crashed" }])
    //#then
    expect(text).toContain("failed: analyzer crashed")
  })

  test("does not let an overall-completed job mask a failed language", () => {
    //#given
    const env: JobEnvelope = { ...envelope, languageStatus: { javascript: "completed", python: "failed" } }
    //#when
    const text = report({}, [{ state: "completed", jobId: env.jobId as string, envelope: env }])
    //#then
    expect(jsonBlock(text).status).toBe("partial")
    expect(text).toContain('language "python" ended with status "failed"')
  })

  test("says an empty result is not proof of safety", () => {
    //#given a completed job with no findings
    const empty: JobEnvelope = { status: "completed", summary: { languages: ["javascript"] }, results: { javascript: { sast: { sast: [] } } } }
    //#when
    const text = report({}, [{ state: "completed", jobId: envelope.jobId as string, envelope: empty }])
    //#then
    expect(text).toContain("not proof the code is free of defects")
  })

  test("surfaces the duplication batching caveat", () => {
    //#given
    const jobs = [job({ note: "Duplication was analysed within this batch only; duplicates spanning batches are not detected." })]
    //#then
    expect(report({ jobs })).toContain("### Caveats")
  })

  test("discloses best-effort analyzers instead of implying verified parsing", () => {
    //#given an analyzer whose shape is unverified
    const env: JobEnvelope = {
      status: "completed",
      results: { javascript: { duplication: { duplicates: [{ file: "probe.js", line: 2, description: "dup", severity: "Major" }] } } },
    }
    //#when
    const text = report({}, [{ state: "completed", jobId: envelope.jobId as string, envelope: env }])
    //#then
    expect(text).toContain("best-effort")
    expect(text).toContain("duplication")
  })

  test("includes severityRaw only when normalisation changed the label", () => {
    //#given one finding whose raw severity is "high" and one whose is "Major"
    const env: JobEnvelope = {
      status: "completed",
      results: { javascript: { sast: { sast: [{ file: "probe.js", line: 1, severity: "high", message: "a" }, { file: "probe.js", line: 2, severity: "Major", message: "b" }] } } },
    }
    //#when
    const data = jsonBlock(report({}, [{ state: "completed", jobId: envelope.jobId as string, envelope: env }]))
    //#then
    const bySev = Object.fromEntries(data.findings.map((f: { line: number }) => [f.line, f]))
    expect(bySev[1].severityRaw).toBe("high")
    expect(bySev[2].severityRaw).toBeUndefined()
  })

  test("flags unmapped paths instead of dropping them", () => {
    //#given a job whose sent files do not include the returned path
    const jobs = [job({ files: [{ filename: "other.js", content: "x" }] })]
    //#when
    const text = report({ jobs })
    //#then
    expect(text).toContain("### Unmapped paths")
    expect(jsonBlock(text).findings.some((f: { unmapped?: boolean }) => f.unmapped)).toBe(true)
  })

  test("reports enqueue errors as problems", () => {
    //#when
    const text = report({ enqueueErrors: ["Could not enqueue a analyze_file job (3 files): HTTP 503"] }, [])
    //#then
    expect(text).toContain("### Unavailable / Failed")
    expect(jsonBlock(text).status).toBe("failed")
  })

  test("escapes pipes so table rows stay intact", () => {
    //#given a rule explanation containing a pipe
    const env: JobEnvelope = {
      status: "completed",
      results: { js: { violations: { violations: { info: { violations: { R: { files: [{ filePath: "/probe.js", line: 1 }], explanation: "a | b", severity: "Major", title: "R" } } } } } } },
    }
    //#when
    const text = report({}, [{ state: "completed", jobId: envelope.jobId as string, envelope: env }])
    //#then
    expect(text).toContain("a \\| b")
  })
})
