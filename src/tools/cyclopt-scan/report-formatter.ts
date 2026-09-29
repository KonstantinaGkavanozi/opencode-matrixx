import { type NormalizedJob, normalizeEnvelope } from "./result-normalizer"
import type { CycloptFinding, MetricsSummary, ScanReportInput, Severity } from "./types"

const ORDER: Severity[] = ["critical", "major", "minor", "info"]
const TABLE_ROW_CAP = 200
const JSON_FINDING_CAP = 500

const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 240)

function sortFindings(list: CycloptFinding[]): CycloptFinding[] {
  return [...list].sort(
    (a, b) =>
      ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) ||
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.rule.localeCompare(b.rule),
  )
}

function findingsTable(list: CycloptFinding[]): string {
  const rows = list.slice(0, TABLE_ROW_CAP).map((f, i) => {
    const loc = f.line ? `${f.file}:${f.line}` : f.file
    return `| ${i + 1} | ${cell(f.analyzer)} | ${cell(f.rule)} | ${cell(loc)}${f.unmapped ? " ⚠" : ""} | ${cell(f.message)} |`
  })
  const more = list.length > TABLE_ROW_CAP ? `\n_…and ${list.length - TABLE_ROW_CAP} more (see JSON block)_` : ""
  return `| # | Analyzer | Rule | Location | Description |\n|---|---|---|---|---|\n${rows.join("\n")}${more}`
}

function mergeMetrics(all: MetricsSummary[]): MetricsSummary[] {
  const byLang = new Map<string, MetricsSummary>()
  for (const m of all) {
    const cur = byLang.get(m.language) ?? { language: m.language, values: {}, scores: {} }
    Object.assign(cur.values, m.values)
    Object.assign(cur.scores, m.scores)
    byLang.set(m.language, cur)
  }
  return [...byLang.values()]
}

function elapsed(created: string[], completed: string[]): string | undefined {
  const start = Math.min(...created.map((d) => Date.parse(d)).filter(Number.isFinite))
  const end = Math.max(...completed.map((d) => Date.parse(d)).filter(Number.isFinite))
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  const s = Math.round((end - start) / 1000)
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
}

export function formatReport(input: ScanReportInput): string {
  const findings: CycloptFinding[] = []
  const metrics: MetricsSummary[] = []
  const problems: string[] = [...input.enqueueErrors]
  const notes = new Set<string>()
  const created: string[] = []
  const completedAt: string[] = []
  const languages = new Set<string>()
  let completed = 0

  for (const outcome of input.outcomes) {
    const job = input.jobs.find((j) => j.jobId === outcome.jobId)
    if (job?.note) notes.add(job.note)
    if (outcome.state === "failed") problems.push(`Job ${outcome.jobId} failed: ${outcome.error}`)
    else if (outcome.state === "timeout") problems.push(`Job ${outcome.jobId} did not finish before the deadline (still pending — not a clean result).`)
    else if (outcome.state === "aborted") problems.push(`Job ${outcome.jobId} was cancelled before completion.`)
    else {
      completed++
      const known = new Set((job?.files ?? []).map((f) => f.filename))
      const norm: NormalizedJob = normalizeEnvelope(outcome.envelope, known)
      findings.push(...norm.findings)
      metrics.push(...norm.metrics)
      for (const p of norm.languageProblems) problems.push(`Job ${outcome.jobId}: language "${p.language}" ended with status "${p.status}".`)
      for (const l of outcome.envelope.summary?.languages ?? []) languages.add(l)
      if (outcome.envelope.createdAt) created.push(outcome.envelope.createdAt)
      if (outcome.envelope.completedAt) completedAt.push(outcome.envelope.completedAt)
    }
  }

  const filter = input.severityFilter?.length ? new Set(input.severityFilter) : undefined
  const shown = sortFindings(filter ? findings.filter((f) => filter.has(f.severity)) : findings)
  const counts = Object.fromEntries(ORDER.map((s) => [s, shown.filter((f) => f.severity === s).length])) as Record<Severity, number>
  const unmapped = shown.filter((f) => f.unmapped)
  const bestEffort = [...new Set(shown.filter((f) => f.bestEffort).map((f) => f.analyzer))]
  if (bestEffort.length > 0) {
    notes.add(`Findings from ${bestEffort.join(", ")} were extracted best-effort from a response shape that is not fully verified; treat their fields as approximate.`)
  }
  const status = completed === input.outcomes.length && problems.length === 0 ? "complete" : completed > 0 ? "partial" : "failed"
  const merged = mergeMetrics(metrics)
  const time = elapsed(created, completedAt)
  const analyzers = [...new Set(input.jobs.flatMap((j) => j.analyzers ?? ["vulnerabilities"]))]

  const lines: string[] = [
    "## Cyclopt Analysis Report",
    "",
    `**Scope**: ${input.scopeLabel}  ·  **Files sent**: ${input.fileCount}  ·  **Jobs**: ${input.jobs.map((j) => j.jobId).join(", ") || "none"}`,
    `**Analyzers**: ${analyzers.join(", ") || "none"}  ·  **Languages**: ${[...languages].join(", ") || "n/a"}  ·  **Status**: ${status}${time ? `  ·  **Elapsed**: ${time}` : ""}`,
  ]
  if (filter) lines.push(`**Severity filter**: ${[...filter].join(", ")}`)
  if (status !== "complete") lines.push("", "> ⚠ This report is not a full clean bill of health. See “Unavailable / Failed” below.")

  for (const sev of ORDER) {
    const list = shown.filter((f) => f.severity === sev)
    if (list.length === 0) continue
    lines.push("", `### ${sev[0]?.toUpperCase()}${sev.slice(1)} (${list.length})`, findingsTable(list))
  }
  if (shown.length === 0 && completed > 0) {
    lines.push("", "No findings were reported by the analyzers that completed. This reflects Cyclopt's engines only; it is not proof the code is free of defects or vulnerabilities.")
  }

  if (merged.length > 0) {
    lines.push("", "### Quality Scores (0–1, higher is better)", "| Language | Score | Avg value | Avg score |", "|---|---|---|---|")
    for (const m of merged) {
      for (const [k, v] of Object.entries(m.scores)) lines.push(`| ${cell(m.language)} | ${cell(k)} | ${v.avgValue} | ${v.avgScore} |`)
    }
    lines.push("", "### Metrics Summary", "| Language | Metric | Value |", "|---|---|---|")
    for (const m of merged) for (const [k, v] of Object.entries(m.values)) lines.push(`| ${cell(m.language)} | ${cell(k)} | ${v} |`)
  }

  if (notes.size > 0) lines.push("", "### Caveats", ...[...notes].map((n) => `- ${n}`))
  if (unmapped.length > 0) lines.push("", "### Unmapped paths", `${unmapped.length} finding(s) cite a path that could not be matched to a file that was sent (marked ⚠ above).`)
  if (input.skipped.length > 0) {
    const shownSkips = input.skipped.slice(0, 20).map((s) => `- \`${s.path}\` — ${s.reason}`)
    lines.push("", `### Skipped files (${input.skipped.length})`, ...shownSkips)
    if (input.skipped.length > 20) lines.push(`- …and ${input.skipped.length - 20} more`)
  }
  if (problems.length > 0) lines.push("", "### Unavailable / Failed", ...problems.map((p) => `- ${p}`))

  const payload = {
    jobIds: input.jobs.map((j) => j.jobId),
    status,
    languages: [...languages],
    counts,
    scores: Object.fromEntries(merged.map((m) => [m.language, Object.fromEntries(Object.entries(m.scores).map(([k, v]) => [k, v.avgScore]))])),
    findings: shown.slice(0, JSON_FINDING_CAP).map((f) => ({
      analyzer: f.analyzer,
      rule: f.rule,
      file: f.file,
      line: f.line ?? null,
      severity: f.severity,
      category: f.category ?? null,
      // Only when normalisation changed the label (e.g. "high" -> critical); otherwise it is redundant.
      ...(f.severityRaw && f.severityRaw.toLowerCase() !== f.severity ? { severityRaw: f.severityRaw } : {}),
      message: f.message,
      ...(f.unmapped ? { unmapped: true } : {}),
    })),
    truncated: shown.length > JSON_FINDING_CAP,
  }
  lines.push("", "```json cyclopt-findings", JSON.stringify(payload, null, 2), "```")
  return lines.join("\n")
}
