import { isAbsolute, join } from "node:path"
import { z } from "zod"
import type { V2ToolDefinition, V2ToolsRecord } from "../../plugin/types"
import { DEFAULT_GLOBS, SILENT_FAILURE_SCAN_DESCRIPTION } from "./constants"
import { scanPath } from "./scanner"
import type { ScanSeverity, SilentFailureScanResult } from "./types"

function errorResult(message: string): SilentFailureScanResult {
  return {
    status: 2,
    findings: [],
    summary: { filesScanned: 0, total: 0, errors: 0, warnings: 0, byRule: {}, note: message } as SilentFailureScanResult["summary"],
  }
}

export function createSilentFailureScannerTool(ctx: { directory: string }): V2ToolsRecord {
  const silent_failure_scan: V2ToolDefinition = {
    name: "silent_failure_scan",
    description: SILENT_FAILURE_SCAN_DESCRIPTION,
    input: z.object({
      path: z.string().describe("File or directory to scan (absolute, or relative to the project directory)."),
      globs: z
        .array(z.string())
        .optional()
        .describe(`Glob filters when path is a directory (default: ${DEFAULT_GLOBS.join(", ")}).`),
      severity: z.enum(["warn", "error"]).optional().describe("Minimum severity to report (default: warn)."),
    }),
    async execute(args) {
      try {
        const base = ctx.directory
        const target = isAbsolute(args.path) ? args.path : join(base, args.path)
        const result = scanPath({
          base,
          target,
          globs: args.globs,
          threshold: args.severity as ScanSeverity | undefined,
        })
        return { content: JSON.stringify(result, null, 2) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { content: JSON.stringify(errorResult(`silent_failure_scan failed: ${message}`), null, 2) }
      }
    },
  }

  return { silent_failure_scan }
}