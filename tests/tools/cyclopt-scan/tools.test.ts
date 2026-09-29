import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import fixture from "./fixtures/completed-javascript.json"
import { createCycloptTools, resetCycloptJobRegistry } from "../../../src/tools/cyclopt-scan"

let root: string
let savedToken: string | undefined

function put(rel: string, content = "var a = 1\n"): void {
  const abs = join(root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

const ctx = () =>
  ({ abort: new AbortController().signal, metadata: () => {}, sessionID: "s", messageID: "m", agent: "cyclopt", directory: root, worktree: root, ask: async () => {} }) as never

/** Fake server: every enqueued job "completes" after `pendingRounds` polls with the recorded envelope. */
function fakeCyclopt(opts: { pendingRounds?: number; failEnqueue?: boolean } = {}) {
  const enqueued: { tool: string; args: Record<string, unknown> }[] = []
  const polls: string[] = []
  let clock = 0
  const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { method: string; params?: { name: string; arguments: Record<string, unknown> } }
    const reply = (payload: unknown) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } }), { status: 200, headers: { "content-type": "application/json" } })
    if (body.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { status: 200, headers: { "content-type": "application/json" } })
    if (body.method === "notifications/initialized") return new Response("", { status: 202 })
    const p = body.params as { name: string; arguments: Record<string, unknown> }
    if (p.name === "check_analysis_job") {
      const id = String(p.arguments.job_id)
      polls.push(id)
      const seen = polls.filter((x) => x === id).length
      return reply(seen > (opts.pendingRounds ?? 0) ? { ...fixture, jobId: id } : { jobId: id, status: "pending" })
    }
    if (opts.failEnqueue) return new Response("down", { status: 503 })
    enqueued.push({ tool: p.name, args: p.arguments })
    return reply({ jobId: `job-${enqueued.length}`, status: "pending" })
  }
  const deps = { fetchImpl, sleep: async (ms: number) => void (clock += ms), now: () => clock, runGit: () => null }
  return { enqueued, polls, deps }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cyclopt-tool-"))
  savedToken = process.env.CYCLOPT_API_TOKEN
  process.env.CYCLOPT_API_TOKEN = "tok"
  resetCycloptJobRegistry()
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  if (savedToken === undefined) delete process.env.CYCLOPT_API_TOKEN
  else process.env.CYCLOPT_API_TOKEN = savedToken
})

describe("cyclopt_scan", () => {
  test("scans, polls, and returns a report with repo-relative paths", async () => {
    //#given a repo with one source file whose name matches the recorded fixture
    put("probe.js")
    const srv = fakeCyclopt({ pendingRounds: 2 })
    const { cyclopt_scan } = createCycloptTools({ directory: root }, srv.deps)
    //#when
    const out = await cyclopt_scan.execute({ scope: "repo" }, ctx())
    //#then
    expect(out).toContain("## Cyclopt Analysis Report")
    expect(out).toContain("probe.js:1")
    expect(out).toContain("**Status**: complete")
    expect(srv.enqueued).toHaveLength(1)
    expect(srv.enqueued[0]?.tool).toBe("analyze_file")
    expect(srv.polls.length).toBe(3)
  })

  test("uploads file contents but never secrets", async () => {
    //#given
    put("src/app.js")
    put(".env", "TOKEN=abc")
    put("certs/key.pem", "FAKE-KEY-MATERIAL")
    const srv = fakeCyclopt()
    const { cyclopt_scan } = createCycloptTools({ directory: root }, srv.deps)
    //#when
    await cyclopt_scan.execute({ scope: "repo" }, ctx())
    //#then
    const sent = JSON.stringify(srv.enqueued)
    expect(sent).toContain("src/app.js")
    expect(sent).not.toContain("TOKEN=abc")
    expect(sent).not.toContain("FAKE-KEY-MATERIAL")
  })

  test("routes only manifests to analyze_vulnerabilities", async () => {
    //#given
    put("a.js")
    put("package.json", "{}")
    const srv = fakeCyclopt()
    const { cyclopt_scan } = createCycloptTools({ directory: root }, srv.deps)
    //#when
    await cyclopt_scan.execute({ scope: "repo", analyzers: ["sast", "vulnerabilities"] }, ctx())
    //#then
    const vuln = srv.enqueued.find((e) => e.tool === "analyze_vulnerabilities")
    const src = srv.enqueued.find((e) => e.tool === "analyze_file")
    expect(JSON.stringify(vuln?.args)).toContain("package.json")
    expect(JSON.stringify(vuln?.args)).not.toContain("a.js")
    expect(JSON.stringify(src?.args)).not.toContain("package.json")
  })

  test("refuses rather than truncating when the scan exceeds max_scan_bytes", async () => {
    //#given
    put("a.js", "x".repeat(500))
    put("b.js", "x".repeat(500))
    const srv = fakeCyclopt()
    const { cyclopt_scan } = createCycloptTools({ directory: root, config: { max_scan_bytes: 100 } }, srv.deps)
    //#when
    const out = await cyclopt_scan.execute({ scope: "repo" }, ctx())
    //#then
    expect(out).toContain("Refused")
    expect(srv.enqueued).toHaveLength(0)
  })

  test("returns actionable guidance when no token is configured", async () => {
    //#given
    delete process.env.CYCLOPT_API_TOKEN
    put("a.js")
    const srv = fakeCyclopt()
    const { cyclopt_scan } = createCycloptTools({ directory: root }, srv.deps)
    //#when
    const out = await cyclopt_scan.execute({ scope: "repo" }, ctx())
    //#then
    expect(out).toContain("CYCLOPT_API_TOKEN")
    expect(srv.enqueued).toHaveLength(0)
  })

  test("requires paths when scope=paths", async () => {
    //#given
    const { cyclopt_scan } = createCycloptTools({ directory: root }, fakeCyclopt().deps)
    //#then
    expect(await cyclopt_scan.execute({ scope: "paths" }, ctx())).toContain("requires a non-empty 'paths'")
  })

  test("reports a labelled failure, not a clean scan, when enqueue fails", async () => {
    //#given
    put("a.js")
    const srv = fakeCyclopt({ failEnqueue: true })
    const { cyclopt_scan } = createCycloptTools({ directory: root }, srv.deps)
    //#when
    const out = await cyclopt_scan.execute({ scope: "repo" }, ctx())
    //#then
    expect(out).toContain("**Status**: failed")
    expect(out).toContain("Could not enqueue")
  })

  test("on timeout, reports pending jobs and how to resume them", async () => {
    //#given a job that never finishes within the deadline
    put("probe.js")
    const srv = fakeCyclopt({ pendingRounds: 1_000 })
    const { cyclopt_scan } = createCycloptTools({ directory: root, config: { job_timeout_ms: 60_000 } }, srv.deps)
    //#when
    const out = await cyclopt_scan.execute({ scope: "repo" }, ctx())
    //#then
    expect(out).toContain("not a clean result")
    expect(out).toContain('cyclopt_job_status with job_ids=["job-1"]')
  })

  test("reports when nothing is analyzable", async () => {
    //#given only a markdown file
    put("README.md", "# hi")
    const { cyclopt_scan } = createCycloptTools({ directory: root }, fakeCyclopt().deps)
    //#then
    expect(await cyclopt_scan.execute({ scope: "repo" }, ctx())).toContain("No analyzable files")
  })
})

describe("cyclopt_job_status", () => {
  test("resumes a timed-out scan and remaps paths using the registry", async () => {
    //#given a scan that timed out
    put("probe.js")
    const srv = fakeCyclopt({ pendingRounds: 1 })
    const tools = createCycloptTools({ directory: root, config: { job_timeout_ms: 10_000 } }, srv.deps)
    await tools.cyclopt_scan.execute({ scope: "repo" }, ctx())
    //#when the job is checked again
    const out = await tools.cyclopt_job_status.execute({ job_ids: ["job-1"] }, ctx())
    //#then it completes with repo-relative paths, not the sandbox path
    expect(out).toContain("probe.js:1")
    expect(out).toContain("**Status**: complete")
  })

  test("a single check on a still-pending job reports it as unfinished", async () => {
    //#given
    const srv = fakeCyclopt({ pendingRounds: 1_000 })
    const { cyclopt_job_status } = createCycloptTools({ directory: root }, srv.deps)
    //#when
    const out = await cyclopt_job_status.execute({ job_ids: ["nope"] }, ctx())
    //#then
    expect(out).toContain("did not finish")
  })
})
