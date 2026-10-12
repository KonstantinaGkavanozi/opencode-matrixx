import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import {
  countPlanProgressFromContent,
  type PlanProgress,
  readPlanFile,
} from "../../features/mission-state"
import { MAX_PLAN_FILE_BYTES } from "../../features/mission-state/constants"
import type { PluginContext, V2ToolDefinition } from "../../plugin/types"
import { PLAN_FILENAME_KEBAB_REGEX, PLANS_DIR } from "./constants"
import { resolveDirectory } from "./types"

type PlanListProgress = PlanProgress | { unreadable: true }

interface SkippedPlan {
  name: string
  reason: string
}

export function createPlanListTool(
  ctx?: PluginContext,
  cap: number = MAX_PLAN_FILE_BYTES,
): V2ToolDefinition {
  return {
    name: "plan_list",
    description: `List plan files under .matrixx/plans/*.md. Filters *.md with kebab-case, sorts by mtime. Each entry carries \`size\` (bytes) and \`overCap\`. An over-cap plan is still listed — never skipped, never an error — because it is the plan that needs repair: read it with plan_read \`offset\`/\`limit\` or a \`section\` selector, then shrink it with plan_update. The cap is ${cap.toLocaleString("en-US")} bytes. A \`.md\` file whose filename is not kebab-case is not counted; when that happens the response gains \`skipped\`, a list of \`{ name, reason }\` naming the offending file and the rule it broke. The key is absent when nothing is skipped.`,
    input: z.object({}),
    execute: async (_args, context) => {
      try {
        const directory = resolveDirectory(
          (context as { directory?: string })?.directory,
          (ctx as unknown as { directory?: string })?.directory,
        )
        const plansDir = join(directory, PLANS_DIR)
        if (!existsSync(plansDir)) {
          return { content: JSON.stringify({ plans: [] }) }
        }
        // Partition on the SAME regex that gates the listing, so the reported
        // reason can never drift from the check that caused the skip.
        const allNames = readdirSync(plansDir).filter((f) => f.endsWith(".md"))
        const entries: string[] = []
        const skipped: SkippedPlan[] = []
        for (const name of allNames) {
          if (PLAN_FILENAME_KEBAB_REGEX.test(name)) {
            entries.push(name)
            continue
          }
          skipped.push({
            name,
            reason: `Not listed: plan filename "${name}" does not satisfy the kebab-case rule (PLAN_FILENAME_KEBAB_REGEX, /^[a-z0-9-]+\\.md$/). Rename it to lowercase kebab-case to have it counted.`,
          })
        }
        const plans = entries
          .map((fileName) => {
            const filePath = join(plansDir, fileName)
            try {
              const stat = statSync(filePath)
              const content = readPlanFile(filePath, cap)
              const progress: PlanListProgress =
                content === null ? { unreadable: true } : countPlanProgressFromContent(content)
              return {
                fileName,
                filePath,
                mtime: stat.mtime.toISOString(),
                mtimeMs: stat.mtimeMs,
                size: stat.size,
                overCap: stat.size > cap,
                progress,
              }
            } catch {
              return null
            }
          })
          .filter((p): p is NonNullable<typeof p> => p !== null)
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
        return {
          content: skipped.length > 0 ? JSON.stringify({ plans, skipped }) : JSON.stringify({ plans }),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { content: JSON.stringify({ error: "internal_error", message }) }
      }
    },
  }
}