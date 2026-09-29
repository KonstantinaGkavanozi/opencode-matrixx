import type { CycloptAnalyzer } from "../../config/schema"
import { MAX_BATCH_BYTES } from "./constants"
import type { CollectedFiles, PlannedJob, SendFile } from "./types"

const byteLength = (f: SendFile) => Buffer.byteLength(f.content, "utf8")

/** Pack files into batches capped by count and bytes. Input order is preserved (callers sort by path). */
export function packBatches(files: SendFile[], maxFiles: number, maxBytes = MAX_BATCH_BYTES): SendFile[][] {
  const batches: SendFile[][] = []
  let cur: SendFile[] = []
  let curBytes = 0
  for (const file of files) {
    const size = byteLength(file)
    if (cur.length > 0 && (cur.length >= maxFiles || curBytes + size > maxBytes)) {
      batches.push(cur)
      cur = []
      curBytes = 0
    }
    cur.push(file)
    curBytes += size
  }
  if (cur.length > 0) batches.push(cur)
  return batches
}

/** Group manifests by directory so a manifest and its lockfile travel together. */
function manifestGroups(manifests: SendFile[]): SendFile[][] {
  const groups = new Map<string, SendFile[]>()
  for (const file of manifests) {
    const dir = file.filename.includes("/") ? file.filename.slice(0, file.filename.lastIndexOf("/")) : ""
    groups.set(dir, [...(groups.get(dir) ?? []), file])
  }
  return [...groups.values()]
}

/**
 * Turn collected files into jobs.
 *
 * Duplication is cross-file: splitting a duplicated pair across two jobs hides
 * it. So duplication gets one whole-scope job when everything fits in a single
 * request body; otherwise it runs per batch and the job carries an explicit
 * caveat that surfaces in the report.
 */
export function planJobs(
  collected: Pick<CollectedFiles, "source" | "manifests">,
  analyzers: CycloptAnalyzer[],
  maxBatchFiles: number,
): PlannedJob[] {
  const jobs: PlannedJob[] = []
  const wantsDuplication = analyzers.includes("duplication")
  const sourceAnalyzers = analyzers.filter((a) => a !== "vulnerabilities" && a !== "duplication")

  if (collected.source.length > 0) {
    if (sourceAnalyzers.length > 0) {
      for (const files of packBatches(collected.source, maxBatchFiles)) {
        jobs.push({ tool: "analyze_file", analyzers: sourceAnalyzers, files })
      }
    }
    if (wantsDuplication) {
      const whole = packBatches(collected.source, Number.MAX_SAFE_INTEGER)
      if (whole.length === 1) {
        jobs.push({ tool: "analyze_file", analyzers: ["duplication"], files: whole[0] as SendFile[] })
      } else {
        for (const files of packBatches(collected.source, maxBatchFiles)) {
          jobs.push({
            tool: "analyze_file",
            analyzers: ["duplication"],
            files,
            note: "Duplication was analysed within this batch only; duplicates spanning batches are not detected.",
          })
        }
      }
    }
  }

  if (analyzers.includes("vulnerabilities")) {
    for (const files of manifestGroups(collected.manifests)) {
      jobs.push({ tool: "analyze_vulnerabilities", files })
    }
  }
  return jobs
}
