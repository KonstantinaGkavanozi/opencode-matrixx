export type ScanSeverity = "warn" | "error"

export interface SilentFailureFinding {
  rule: string
  severity: ScanSeverity
  file: string
  line: number
  excerpt: string
  why: string
  fix: string
}

export interface SilentFailureSummary {
  filesScanned: number
  total: number
  errors: number
  warnings: number
  byRule: Record<string, number>
}

export interface SilentFailureScanResult {
  status: 0 | 1 | 2
  findings: SilentFailureFinding[]
  summary: SilentFailureSummary
}
