import type { CycloptFinding, JobEnvelope, MetricsSummary, Severity } from "./types"

export type NormalizedJob = {
  findings: CycloptFinding[]
  metrics: MetricsSummary[]
  /** Languages whose own status was not "completed", even if the job was. */
  languageProblems: { language: string; status: string }[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)

export function normalizeSeverity(raw: unknown): Severity {
  const s = String(raw ?? "").toLowerCase()
  if (s === "critical" || s === "blocker" || s === "high" || s === "error") return "critical"
  if (s === "major" || s === "medium" || s === "moderate" || s === "warning") return "major"
  if (s === "minor" || s === "low") return "minor"
  return "info"
}

/**
 * Map a path from a Cyclopt result back to the repo-relative filename that was
 * sent. Results come back as "/probe.js" (sandbox-root-relative) or as a full
 * ephemeral sandbox path like "/tmp/<id>/<id>/probe.js"; neither is usable
 * downstream. Longest matching suffix wins; a bare basename maps only when it
 * is unambiguous.
 */
export function remapPath(raw: string, known: ReadonlySet<string>): { file: string; unmapped: boolean } {
  const norm = raw.split("\\").join("/")
  const segs = norm.split("/").filter(Boolean)
  for (let i = 0; i < segs.length; i++) {
    const candidate = segs.slice(i).join("/")
    if (known.has(candidate)) return { file: candidate, unmapped: false }
  }
  const last = segs[segs.length - 1]
  if (last) {
    const matches = [...known].filter((k) => k === last || k.endsWith(`/${last}`))
    if (matches.length === 1) return { file: matches[0] as string, unmapped: false }
  }
  return { file: norm, unmapped: true }
}

function pickFile(item: Obj): string {
  const loc = isObj(item.location) ? item.location : undefined
  const candidate = item.filePath ?? item.file ?? item.path ?? item.filename ?? loc?.file ?? loc?.path
  return typeof candidate === "string" ? candidate : ""
}

function pickLine(item: Obj): number | undefined {
  const start = isObj(item.start) ? item.start : undefined
  const loc = isObj(item.location) ? item.location : undefined
  const n = item.line ?? item.startLine ?? start?.line ?? loc?.line
  return typeof n === "number" ? n : undefined
}

function fromViolations(language: string, node: Obj, known: ReadonlySet<string>): CycloptFinding[] | undefined {
  const outer = node.violations
  if (!isObj(outer)) return undefined
  const out: CycloptFinding[] = []
  let recognised = false
  for (const bucket of Object.values(outer)) {
    if (!isObj(bucket) || !isObj(bucket.violations)) continue
    recognised = true
    for (const [rule, entry] of Object.entries(bucket.violations)) {
      if (!isObj(entry)) continue
      const files = Array.isArray(entry.files) ? entry.files : []
      for (const occ of files) {
        if (!isObj(occ)) continue
        const mapped = remapPath(pickFile(occ), known)
        out.push({
          analyzer: "violations",
          language,
          rule,
          title: String(entry.title ?? rule),
          category: typeof entry.category === "string" ? entry.category : undefined,
          file: mapped.file,
          line: pickLine(occ),
          severity: normalizeSeverity(entry.severity),
          severityRaw: typeof entry.severity === "string" ? entry.severity : undefined,
          message: String(entry.explanation ?? entry.title ?? rule),
          unmapped: mapped.unmapped || undefined,
        })
      }
    }
  }
  return recognised ? out : undefined
}

function fromMetrics(language: string, node: Obj, known: ReadonlySet<string>): CycloptFinding[] {
  const out: CycloptFinding[] = []
  for (const [metric, entry] of Object.entries(isObj(node.metricsRecommendations) ? node.metricsRecommendations : {})) {
    if (!isObj(entry) || !Array.isArray(entry.files)) continue
    for (const occ of entry.files) {
      if (!isObj(occ)) continue
      const mapped = remapPath(pickFile(occ), known)
      out.push({
        analyzer: "metrics",
        language,
        rule: `metric:${metric}`,
        title: `Metric flagged: ${metric}`,
        file: mapped.file,
        line: pickLine(occ),
        severity: "info",
        message: `${metric} = ${String(occ.value)} (flagged by Cyclopt metrics recommendations)`,
        unmapped: mapped.unmapped || undefined,
      })
    }
  }
  return out
}

function metricsSummary(language: string, node: Obj): MetricsSummary | undefined {
  const values: Record<string, number> = {}
  if (isObj(node.metrics)) {
    for (const [k, v] of Object.entries(node.metrics)) if (typeof v === "number") values[k] = v
  }
  const scores: MetricsSummary["scores"] = {}
  for (const family of ["metricsScores", "violationsScores", "sastScores"]) {
    const src = node[family]
    if (!isObj(src)) continue
    for (const [k, v] of Object.entries(src)) {
      if (isObj(v) && typeof v.avgScore === "number" && typeof v.avgValue === "number") {
        scores[k] = { avgValue: v.avgValue, avgScore: v.avgScore }
      }
    }
  }
  return Object.keys(values).length + Object.keys(scores).length > 0 ? { language, values, scores } : undefined
}

const SKIP_KEYS = /score|metric|stat/i

/** Best-effort walk for analyzers whose response shape has not been verified live. */
function collectObjectArrays(node: unknown, depth = 0, out: Obj[] = []): Obj[] {
  if (depth > 4) return out
  if (Array.isArray(node)) {
    for (const item of node) {
      if (isObj(item)) out.push(item)
      else collectObjectArrays(item, depth + 1, out)
    }
  } else if (isObj(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (SKIP_KEYS.test(k)) continue
      collectObjectArrays(v, depth + 1, out)
    }
  }
  return out
}

function genericFindings(analyzer: string, language: string, node: unknown, known: ReadonlySet<string>): CycloptFinding[] {
  return collectObjectArrays(node).map((item) => {
    const rawFile = pickFile(item)
    const mapped = rawFile ? remapPath(rawFile, known) : { file: "(no file reported)", unmapped: false }
    const rule = item.ruleId ?? item.rule ?? item.check_id ?? item.cve ?? item.id ?? item.name ?? item.type ?? analyzer
    const message = item.message ?? item.description ?? item.title ?? item.explanation
    return {
      analyzer,
      language,
      rule: String(rule),
      title: String(item.title ?? rule),
      category: typeof item.category === "string" ? item.category : undefined,
      file: mapped.file,
      line: pickLine(item),
      severity: normalizeSeverity(item.severity),
      severityRaw: typeof item.severity === "string" ? item.severity : undefined,
      message: typeof message === "string" ? message : JSON.stringify(item).slice(0, 300),
      unmapped: mapped.unmapped || undefined,
      bestEffort: true,
    }
  })
}

/** Unwrap one completed job envelope into flat findings with repo-relative paths. */
export function normalizeEnvelope(envelope: JobEnvelope, known: ReadonlySet<string>): NormalizedJob {
  const job: NormalizedJob = { findings: [], metrics: [], languageProblems: [] }

  for (const [language, status] of Object.entries(envelope.languageStatus ?? {})) {
    if (String(status).toLowerCase() !== "completed") job.languageProblems.push({ language, status: String(status) })
  }

  for (const [language, analyzers] of Object.entries(envelope.results ?? {})) {
    if (!isObj(analyzers)) continue
    for (const [analyzer, node] of Object.entries(analyzers)) {
      if (!isObj(node)) continue
      const summary = metricsSummary(language, node)
      if (summary) job.metrics.push(summary)

      if (analyzer === "violations") {
        job.findings.push(...(fromViolations(language, node, known) ?? genericFindings(analyzer, language, node, known)))
      } else if (analyzer === "metrics") {
        job.findings.push(...fromMetrics(language, node, known))
      } else if (analyzer === "sast") {
        job.findings.push(...genericFindings(analyzer, language, node.sast, known))
      } else {
        job.findings.push(...genericFindings(analyzer, language, node, known))
      }
    }
  }
  return job
}
