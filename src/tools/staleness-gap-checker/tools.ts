import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { z } from "zod"
import type { V2ToolDefinition, V2ToolsRecord } from "../../plugin/types"
import { analyzeSamples, parseNdjson } from "./checker"
import { STALENESS_GAP_CHECK_DESCRIPTION } from "./constants"
import type { StalenessResult } from "./types"

function errorResult(message: string): StalenessResult {
  return {
    status: 2,
    gaps: [],
    staleness: [],
    summary: {
      samples: 0,
      groups: 0,
      gaps: 0,
      regressions: 0,
      duplicates: 0,
      stale: 0,
      warn: 0,
      healthy: 0,
      note: message,
    },
  }
}

const timestampSchema = z.union([z.number(), z.string()])

export function createStalenessGapCheckerTool(ctx: { directory: string }): V2ToolsRecord {
  const staleness_gap_check: V2ToolDefinition = {
    name: "staleness_gap_check",
    description: STALENESS_GAP_CHECK_DESCRIPTION,
    input: z.object({
      samples: z
        .array(
          z.object({
            symbol: z.string(),
            exchange: z.string(),
            seq: z.number(),
            exchange_ts: timestampSchema,
            pub_ts: timestampSchema.optional(),
          }),
        )
        .optional()
        .describe("In-memory samples. Provide this or logPath."),
      logPath: z
        .string()
        .optional()
        .describe("Path to a newline-delimited JSON file of samples (absolute or project-relative)."),
      maxGapMultiplier: z
        .number()
        .optional()
        .describe("Multiplier of the expected interval above which staleness is a warning (default 2)."),
      now: z
        .number()
        .optional()
        .describe("Reference time in epoch ms for staleness (default: max pub_ts in the input)."),
    }),
    async execute(args) {
      try {
        let samples = args.samples ?? []
        let invalidLines = 0
        if (samples.length === 0 && args.logPath) {
          const target = isAbsolute(args.logPath) ? args.logPath : join(ctx.directory, args.logPath)
          if (!existsSync(target)) {
            return { content: JSON.stringify(errorResult(`logPath not found: ${args.logPath}`), null, 2) }
          }
          const parsed = parseNdjson(readFileSync(target, "utf8"))
          samples = parsed.samples
          invalidLines = parsed.invalid
        }
        if (samples.length === 0) {
          return { content: JSON.stringify(errorResult("provide samples[] or logPath"), null, 2) }
        }

        const result = analyzeSamples(samples, {
          maxGapMultiplier: args.maxGapMultiplier,
          now: args.now,
        })
        if (invalidLines > 0) result.summary.invalidLines = invalidLines
        return { content: JSON.stringify(result, null, 2) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { content: JSON.stringify(errorResult(`staleness_gap_check failed: ${message}`), null, 2) }
      }
    },
  }

  return { staleness_gap_check }
}