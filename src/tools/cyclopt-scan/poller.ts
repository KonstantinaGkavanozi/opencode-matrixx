import type { CycloptClient } from "./client"
import { POLL_FLOOR_MS } from "./constants"
import type { JobOutcome } from "./types"

export type PollOptions = {
  client: Pick<CycloptClient, "fetchJob">
  jobIds: string[]
  intervalMs: number
  timeoutMs: number
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  onProgress?: (pending: number, total: number) => void
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function statusOf(envelope: { status?: string }): string {
  return (envelope.status ?? "").toLowerCase()
}

/**
 * Poll until every job is terminal, the deadline passes, or the caller aborts.
 * The Cyclopt contract forbids polling faster than POLL_FLOOR_MS, so the floor
 * is applied here regardless of configuration. Jobs are always sleep-then-check:
 * they routinely take minutes, so an immediate first check is wasted.
 */
export async function pollJobs(opts: PollOptions): Promise<JobOutcome[]> {
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? Date.now
  const interval = Math.max(opts.intervalMs, POLL_FLOOR_MS)
  const deadline = now() + opts.timeoutMs
  const done = new Map<string, JobOutcome>()

  while (done.size < opts.jobIds.length) {
    if (opts.signal?.aborted) break
    if (now() >= deadline) break
    await sleep(interval)
    if (opts.signal?.aborted) break

    for (const jobId of opts.jobIds) {
      if (done.has(jobId)) continue
      try {
        const envelope = await opts.client.fetchJob(jobId, opts.signal)
        const status = statusOf(envelope)
        if (status === "completed") done.set(jobId, { state: "completed", jobId, envelope })
        else if (status === "failed") {
          done.set(jobId, { state: "failed", jobId, error: String(envelope.error ?? envelope.message ?? "job failed") })
        }
      } catch (err) {
        if (opts.signal?.aborted) break
        // Transient transport errors leave the job pending; the deadline bounds the retries.
        // Auth failures will not recover, so they end the job immediately.
        const message = err instanceof Error ? err.message : String(err)
        if (/HTTP 40[13]/.test(message)) done.set(jobId, { state: "failed", jobId, error: message })
      }
    }
    opts.onProgress?.(opts.jobIds.length - done.size, opts.jobIds.length)
  }

  return opts.jobIds.map((jobId) => {
    const outcome = done.get(jobId)
    if (outcome) return outcome
    return opts.signal?.aborted ? { state: "aborted", jobId } : { state: "timeout", jobId }
  })
}
