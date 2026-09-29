import { describe, expect, test } from "bun:test"
import { packBatches, planJobs } from "../../../src/tools/cyclopt-scan/batcher"
import type { SendFile } from "../../../src/tools/cyclopt-scan/types"

const f = (name: string, size = 10): SendFile => ({ filename: name, content: "x".repeat(size) })

describe("packBatches", () => {
  test("caps batches by file count", () => {
    //#when
    const batches = packBatches([f("a"), f("b"), f("c")], 2)
    //#then
    expect(batches.map((b) => b.length)).toEqual([2, 1])
  })

  test("caps batches by bytes without dropping an oversize single file", () => {
    //#when
    const batches = packBatches([f("a", 60), f("b", 60), f("c", 500)], 100, 100)
    //#then each file lands somewhere; the oversize one gets its own batch
    expect(batches.flat().map((x) => x.filename)).toEqual(["a", "b", "c"])
    expect(batches.at(-1)?.map((x) => x.filename)).toEqual(["c"])
  })

  test("returns no batches for no files", () => {
    //#then
    expect(packBatches([], 10)).toEqual([])
  })
})

describe("planJobs", () => {
  test("routes source to analyze_file and manifests to analyze_vulnerabilities only", () => {
    //#when
    const jobs = planJobs({ source: [f("a.ts")], manifests: [f("package.json")] }, ["metrics", "vulnerabilities"], 60)
    //#then
    expect(jobs.map((j) => j.tool)).toEqual(["analyze_file", "analyze_vulnerabilities"])
    expect(jobs[0]?.analyzers).toEqual(["metrics"])
    expect(jobs[0]?.files.map((x) => x.filename)).toEqual(["a.ts"])
    expect(jobs[1]?.files.map((x) => x.filename)).toEqual(["package.json"])
  })

  test("does not upload manifests unless vulnerabilities was requested", () => {
    //#when
    const jobs = planJobs({ source: [f("a.ts")], manifests: [f("package.json")] }, ["metrics"], 60)
    //#then
    expect(jobs.every((j) => j.tool === "analyze_file")).toBe(true)
  })

  test("groups manifests by directory so a manifest travels with its lockfile", () => {
    //#when
    const jobs = planJobs(
      { source: [], manifests: [f("package.json"), f("package-lock.json"), f("web/package.json")] },
      ["vulnerabilities"],
      60,
    )
    //#then
    expect(jobs).toHaveLength(2)
    expect(jobs[0]?.files.map((x) => x.filename)).toEqual(["package.json", "package-lock.json"])
  })

  test("runs duplication as ONE whole-scope job when everything fits", () => {
    //#given 5 files but a batch size of 2
    const source = ["a", "b", "c", "d", "e"].map((n) => f(`${n}.ts`))
    //#when
    const jobs = planJobs({ source, manifests: [] }, ["violations", "duplication"], 2)
    const dup = jobs.filter((j) => j.analyzers?.includes("duplication"))
    //#then duplication saw every file together, with no caveat
    expect(dup).toHaveLength(1)
    expect(dup[0]?.files).toHaveLength(5)
    expect(dup[0]?.note).toBeUndefined()
    expect(jobs.filter((j) => j.analyzers?.includes("violations"))).toHaveLength(3)
  })

  test("falls back to per-batch duplication WITH an explicit caveat when scope is too large", () => {
    //#given enough bytes that the whole set cannot fit in one request
    const source = [f("a.ts", 1_500_000), f("b.ts", 1_500_000)]
    //#when
    const jobs = planJobs({ source, manifests: [] }, ["duplication"], 60)
    //#then
    expect(jobs.length).toBeGreaterThan(1)
    expect(jobs.every((j) => j.note?.includes("within this batch only"))).toBe(true)
  })

  test("plans nothing when there is nothing for the requested analyzers", () => {
    //#then
    expect(planJobs({ source: [f("a.ts")], manifests: [] }, ["vulnerabilities"], 60)).toEqual([])
  })
})
