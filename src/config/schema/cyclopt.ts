import { z } from "zod"

export const CycloptAnalyzerSchema = z.enum(["metrics", "violations", "sast", "duplication", "vulnerabilities"])

export type CycloptAnalyzer = z.infer<typeof CycloptAnalyzerSchema>

export const CycloptConfigSchema = z.object({
  /**
   * Cyclopt API token. Honoured ONLY from the user-level config
   * (~/.config/opencode/matrixx.jsonc); ignored in a project's .opencode/matrixx.jsonc
   * because project files are commonly committed. The CYCLOPT_API_TOKEN env var, when set, wins.
   */
  api_token: z.string().min(1).optional(),
  /** Cyclopt MCP endpoint. */
  base_url: z.string().url().default("https://mcp-server.cyclopt.com/mcp"),
  /** Analyzers cyclopt_scan runs when the caller does not specify any. */
  default_analyzers: z.array(CycloptAnalyzerSchema).default(["metrics", "violations", "sast"]),
  /** Per-file byte cap. Larger files are skipped and listed in the report. */
  max_file_bytes: z.number().int().positive().default(256_000),
  /** Files per enqueued batch. Biased large: per-job latency (minutes) dominates. */
  max_batch_files: z.number().int().positive().default(60),
  /** Total bytes per scan. Over this the scan is refused, never silently truncated. */
  max_scan_bytes: z.number().int().positive().default(8_000_000),
  /** Poll interval. The Cyclopt server contract forbids polling faster than every 10s. */
  poll_interval_ms: z.number().int().min(10_000).default(15_000),
  /** Overall scan deadline. A single 4-line file was measured at ~3m46s. */
  job_timeout_ms: z.number().int().positive().default(900_000),
  /**
   * Expose Cyclopt's code fixer (fix_code, check_fix_job, check_fix_usage) to Matrixx agents.
   * Default false: the tools are hidden from every agent. The `cyclopt` agent itself stays
   * report-only either way; enabling this lets other agents (e.g. Morpheus) call the fixer.
   * fix_code rewrites files with an LLM and consumes Cyclopt fix credits.
   */
  allow_fix_code: z.boolean().default(false),
  /** Extra exclude path fragments, merged with the built-in secret guard. */
  exclude: z.array(z.string()).optional(),
})

export type CycloptConfig = z.infer<typeof CycloptConfigSchema>
