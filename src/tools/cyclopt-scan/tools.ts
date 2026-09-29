import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool"
import { type CycloptAnalyzer, type CycloptConfig, CycloptConfigSchema } from "../../config/schema"
import { resolveCycloptEndpoint } from "../../mcp/cyclopt-endpoint"
import { planJobs } from "./batcher"
import { type ClientDeps, createCycloptClient } from "./client"
import { type CollectOptions, collectFiles } from "./file-collector"
import { pollJobs } from "./poller"
import { formatReport } from "./report-formatter"
import type { EnqueuedJob, JobOutcome, ScanScope, Severity } from "./types"

export type CycloptToolDeps = ClientDeps & {
  now?: () => number
  runGit?: CollectOptions["runGit"]
}

/** In-memory registry so a timed-out scan can be resumed with cyclopt_job_status. */
const jobRegistry = new Map<string, EnqueuedJob>()
export function resetCycloptJobRegistry(): void {
  jobRegistry.clear()
}

const ANALYZERS = ["metrics", "violations", "sast", "duplication", "vulnerabilities"] as const

function scopeLabel(scope: ScanScope, paths?: string[]): string {
  if (scope === "paths") return `paths: ${(paths ?? []).join(", ")}`
  if (scope === "changed") return "changed files (git diff vs merge-base, plus untracked)"
  if (scope === "staged") return "staged files"
  return "whole repository"
}

export function createCycloptTools(
  input: { directory: string; config?: Partial<CycloptConfig> },
  deps: CycloptToolDeps = {},
): Record<string, ToolDefinition> {
  const cfg = CycloptConfigSchema.parse(input.config ?? {})

  const cyclopt_scan: ToolDefinition = tool({
    description:
      "Run Cyclopt code analysis (metrics, violations, SAST, duplication, dependency vulnerabilities) over a set of project files and return ONE aggregated report. " +
      "Read-only: reports findings, never modifies code. Jobs run on Cyclopt's servers and routinely take SEVERAL MINUTES — this call blocks until they finish. " +
      "PRIVACY: file contents are uploaded to the Cyclopt service. Secrets (.env, keys, certificates), node_modules, dist and .git are always excluded. " +
      "scope: 'changed' (default; git diff vs merge-base plus untracked), 'staged', 'repo' (whole repository — large, ask first), or 'paths'.",
    args: {
      scope: tool.schema.enum(["repo", "staged", "changed", "paths"]).optional().describe("What to scan. Default 'changed'."),
      paths: tool.schema.array(tool.schema.string()).optional().describe("Files or directories relative to the project root. Required when scope='paths'."),
      analyzers: tool.schema.array(tool.schema.enum(ANALYZERS)).optional().describe("Analyzers to run. Default from config (metrics, violations, sast)."),
      severity: tool.schema.array(tool.schema.enum(["critical", "major", "minor", "info"])).optional().describe("Only report findings of these severities."),
      max_files: tool.schema.number().int().positive().optional().describe("Hard ceiling on files sent (default 200)."),
    },
    execute: async (args, context) => {
      const resolution = resolveCycloptEndpoint(cfg)
      if (!resolution.ok) return `Cyclopt is unavailable: ${resolution.error}`
      const scope: ScanScope = args.scope ?? "changed"
      if (scope === "paths" && !args.paths?.length) return "Error: scope='paths' requires a non-empty 'paths' array."

      const analyzers = (args.analyzers ?? cfg.default_analyzers) as CycloptAnalyzer[]
      const collected = collectFiles({
        directory: input.directory,
        scope,
        paths: args.paths,
        maxFiles: args.max_files ?? 200,
        maxFileBytes: cfg.max_file_bytes,
        extraExcludes: cfg.exclude,
        runGit: deps.runGit,
      })
      if (collected.source.length + collected.manifests.length === 0) {
        return `No analyzable files found for scope "${scope}". ${collected.skipped.length} file(s) were skipped by the secret guard/size limits.`
      }
      if (collected.totalBytes > cfg.max_scan_bytes) {
        return `Refused: ${collected.source.length + collected.manifests.length} files total ${collected.totalBytes} bytes, over max_scan_bytes (${cfg.max_scan_bytes}). Narrow the scope (scope='paths') instead of truncating.`
      }
      const planned = planJobs(collected, analyzers, cfg.max_batch_files)
      if (planned.length === 0) return "Nothing to analyze: the requested analyzers matched none of the collected files (e.g. 'vulnerabilities' needs a dependency manifest)."

      const client = createCycloptClient(resolution.endpoint, deps)
      const jobs: EnqueuedJob[] = []
      const enqueueErrors: string[] = []
      for (const job of planned) {
        try {
          const jobId = await client.enqueue(job, context.abort)
          const enqueued = { ...job, jobId }
          jobs.push(enqueued)
          jobRegistry.set(jobId, enqueued)
        } catch (err) {
          enqueueErrors.push(`Could not enqueue a ${job.tool} job (${job.files.length} files): ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      const outcomes = await pollJobs({
        client,
        jobIds: jobs.map((j) => j.jobId),
        intervalMs: cfg.poll_interval_ms,
        timeoutMs: cfg.job_timeout_ms,
        signal: context.abort,
        sleep: deps.sleep,
        now: deps.now,
        onProgress: (pending, total) => context.metadata({ title: `Cyclopt: ${total - pending}/${total} jobs done` }),
      })

      const report = formatReport({
        scopeLabel: scopeLabel(scope, args.paths),
        fileCount: collected.source.length + collected.manifests.length,
        skipped: collected.skipped,
        jobs,
        outcomes,
        severityFilter: args.severity as Severity[] | undefined,
        enqueueErrors,
      })
      const pending = outcomes.filter((o) => o.state === "timeout").map((o) => o.jobId)
      return pending.length > 0 ? `${report}\n\nTo keep waiting on unfinished jobs call cyclopt_job_status with job_ids=${JSON.stringify(pending)}.` : report
    },
  })

  const cyclopt_job_status: ToolDefinition = tool({
    description:
      "Check (and optionally wait for) Cyclopt jobs started by cyclopt_scan, e.g. after it timed out. Returns the same report format. " +
      "Polls no faster than every 10 seconds. Reports only what Cyclopt returns; never analyses code itself.",
    args: {
      job_ids: tool.schema.array(tool.schema.string()).min(1).describe("Exact job ids returned by cyclopt_scan."),
      wait_seconds: tool.schema.number().int().min(0).max(900).optional().describe("How long to keep polling. 0 = a single check. Default 0."),
    },
    execute: async (args, context) => {
      const resolution = resolveCycloptEndpoint(cfg)
      if (!resolution.ok) return `Cyclopt is unavailable: ${resolution.error}`
      const client = createCycloptClient(resolution.endpoint, deps)
      const jobs: EnqueuedJob[] = args.job_ids.map(
        (jobId) => jobRegistry.get(jobId) ?? { jobId, tool: "analyze_file", files: [] },
      )
      const wait = (args.wait_seconds ?? 0) * 1000
      let outcomes: JobOutcome[]
      if (wait === 0) {
        outcomes = await Promise.all(
          args.job_ids.map(async (jobId): Promise<JobOutcome> => {
            try {
              const envelope = await client.fetchJob(jobId, context.abort)
              const status = (envelope.status ?? "").toLowerCase()
              if (status === "completed") return { state: "completed", jobId, envelope }
              if (status === "failed") return { state: "failed", jobId, error: String(envelope.error ?? envelope.message ?? "job failed") }
              return { state: "timeout", jobId }
            } catch (err) {
              return { state: "failed", jobId, error: err instanceof Error ? err.message : String(err) }
            }
          }),
        )
      } else {
        outcomes = await pollJobs({
          client,
          jobIds: args.job_ids,
          intervalMs: cfg.poll_interval_ms,
          timeoutMs: wait,
          signal: context.abort,
          sleep: deps.sleep,
          now: deps.now,
        })
      }
      return formatReport({
        scopeLabel: "resumed jobs",
        fileCount: jobs.reduce((n, j) => n + j.files.length, 0),
        skipped: [],
        jobs,
        outcomes,
        enqueueErrors: [],
      })
    },
  })

  return { cyclopt_scan, cyclopt_job_status }
}
