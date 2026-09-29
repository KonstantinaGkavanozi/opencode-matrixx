/**
 * Live smoke test for the cyclopt_scan transport (Streamable-HTTP JSON-RPC).
 *
 *   bun run script/cyclopt-smoke.ts [--wait]
 *
 * Reads the token from CYCLOPT_API_TOKEN, else cyclopt.api_token in the user-level matrixx config.
 *
 * Without --wait it only verifies the handshake + enqueue (seconds).
 * With --wait it polls to completion (jobs take minutes) and prints the report.
 * The token is never printed.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { resolveCycloptEndpoint } from "../src/mcp/cyclopt-endpoint"
import { getOpenCodeConfigDir, parseJsonc } from "../src/shared"
import { createCycloptClient } from "../src/tools/cyclopt-scan/client"
import { pollJobs } from "../src/tools/cyclopt-scan/poller"
import { formatReport } from "../src/tools/cyclopt-scan/report-formatter"
import type { EnqueuedJob } from "../src/tools/cyclopt-scan/types"

function readUserCycloptConfig(): { api_token?: string; base_url?: string } | undefined {
  const dir = getOpenCodeConfigDir({ binary: "opencode" })
  for (const name of ["matrixx.jsonc", "matrixx.json"]) {
    const file = join(dir, name)
    if (!existsSync(file)) continue
    return parseJsonc<{ cyclopt?: { api_token?: string; base_url?: string } }>(readFileSync(file, "utf-8")).cyclopt
  }
  return undefined
}

const resolution = resolveCycloptEndpoint(readUserCycloptConfig())
if (!resolution.ok) {
  console.error(resolution.error)
  process.exit(1)
}

const client = createCycloptClient(resolution.endpoint)
const files = [{ filename: "smoke/probe.js", content: "var unused = 1;\nfunction f(a){ if(a){ return a } return 0 }\n" }]
const job = { tool: "analyze_file" as const, analyzers: ["metrics" as const, "violations" as const], files }

console.log(`[1/3] Handshake + enqueue against ${resolution.endpoint.baseUrl} ...`)
const jobId = await client.enqueue(job)
console.log(`      OK - job id: ${jobId}`)

if (!process.argv.includes("--wait")) {
  console.log("[2/3] Skipped polling (pass --wait to poll to completion; takes minutes).")
  console.log("      Transport verified: initialize -> tools/call(analyze_file) works from this process.")
  process.exit(0)
}

console.log("[2/3] Polling every 15s (no faster than the 10s server floor) ...")
const outcomes = await pollJobs({
  client,
  jobIds: [jobId],
  intervalMs: 15_000,
  timeoutMs: 900_000,
  onProgress: (pending, total) => console.log(`      ${total - pending}/${total} jobs done`),
})

console.log("[3/3] Report:\n")
const enqueued: EnqueuedJob = { ...job, jobId }
console.log(formatReport({ scopeLabel: "smoke test", fileCount: 1, skipped: [], jobs: [enqueued], outcomes, enqueueErrors: [] }))
