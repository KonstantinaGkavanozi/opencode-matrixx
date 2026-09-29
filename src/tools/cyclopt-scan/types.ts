import type { CycloptAnalyzer } from "../../config/schema"

export type SendFile = { filename: string; content: string }

export type ScanScope = "repo" | "staged" | "changed" | "paths"

export type Severity = "critical" | "major" | "minor" | "info"

/** One occurrence of one finding, after normalisation. `file` is repo-relative when mappable. */
export type CycloptFinding = {
  analyzer: string
  language: string
  rule: string
  title: string
  category?: string
  file: string
  line?: number
  severity: Severity
  /** Severity string exactly as Cyclopt returned it. */
  severityRaw?: string
  message: string
  /** True when the path could not be matched to a file that was sent. */
  unmapped?: boolean
  /** True for analyzers whose response shape has not been verified live. */
  bestEffort?: boolean
}

export type MetricsSummary = {
  language: string
  values: Record<string, number>
  scores: Record<string, { avgValue: number; avgScore: number }>
}

export type CollectedFiles = {
  source: SendFile[]
  manifests: SendFile[]
  skipped: { path: string; reason: string }[]
  totalBytes: number
}

export type PlannedJob = {
  /** MCP tool name on the Cyclopt server. */
  tool: "analyze_file" | "analyze_vulnerabilities"
  analyzers?: CycloptAnalyzer[]
  files: SendFile[]
  /** Caveat surfaced in the report, e.g. duplication limited to one batch. */
  note?: string
}

export type EnqueuedJob = PlannedJob & { jobId: string }

export type JobEnvelope = {
  jobId?: string
  status?: string
  summary?: { totalFiles?: number; languages?: string[]; analyzers?: string[] }
  languageStatus?: Record<string, string>
  createdAt?: string
  completedAt?: string
  results?: Record<string, Record<string, unknown>>
  error?: unknown
  message?: string
}

export type JobOutcome =
  | { state: "completed"; jobId: string; envelope: JobEnvelope }
  | { state: "failed"; jobId: string; error: string }
  | { state: "timeout"; jobId: string }
  | { state: "aborted"; jobId: string }

export type ScanReportInput = {
  scopeLabel: string
  fileCount: number
  skipped: { path: string; reason: string }[]
  jobs: EnqueuedJob[]
  outcomes: JobOutcome[]
  severityFilter?: Severity[]
  /** Set when enqueueing itself failed for some jobs. */
  enqueueErrors: string[]
}
