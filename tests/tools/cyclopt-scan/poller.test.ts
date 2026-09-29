import { describe, expect, test } from "bun:test"
import { POLL_FLOOR_MS } from "../../../src/tools/cyclopt-scan/constants"
import { pollJobs } from "../../../src/tools/cyclopt-scan/poller"
import type { JobEnvelope } from "../../../src/tools/cyclopt-scan/types"

/** Fake clock: sleeping advances virtual time and records the requested delay. */
function clock() {
  let t = 0
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
  }
}

const scripted = (script: Record<string, JobEnvelope[]>) => {
  const seen: Record<string, number> = {}
  return {
    fetchJob: async (id: string) => {
      const i = seen[id] ?? 0
      seen[id] = i + 1
      const list = script[id] ?? [{ status: "pending" }]
      return list[Math.min(i, list.length - 1)] as JobEnvelope
    },
  }
}

describe("pollJobs", () => {
  test("never polls faster than the 10s server floor, even if configured lower", async () => {
    //#given a configured interval far below the floor
    const c = clock()
    const client = scripted({ a: [{ status: "pending" }, { status: "completed" }] })
    //#when
    await pollJobs({ client, jobIds: ["a"], intervalMs: 500, timeoutMs: 600_000, sleep: c.sleep, now: c.now })
    //#then every sleep respected the floor
    expect(c.sleeps.length).toBeGreaterThan(0)
    expect(c.sleeps.every((ms) => ms >= POLL_FLOOR_MS)).toBe(true)
  })

  test("sleeps before the first check because jobs take minutes", async () => {
    //#given
    const c = clock()
    const order: string[] = []
    const client = {
      fetchJob: async () => {
        order.push("fetch")
        return { status: "completed" } as JobEnvelope
      },
    }
    //#when
    await pollJobs({ client, jobIds: ["a"], intervalMs: 15_000, timeoutMs: 600_000, sleep: async (ms) => { order.push("sleep"); await c.sleep(ms) }, now: c.now })
    //#then
    expect(order).toEqual(["sleep", "fetch"])
  })

  test("returns completed envelopes and stops re-polling finished jobs", async () => {
    //#given a finishes first, b later
    const c = clock()
    let aFetches = 0
    const client = {
      fetchJob: async (id: string) => {
        if (id === "a") {
          aFetches++
          return { status: "completed" } as JobEnvelope
        }
        return { status: c.now() >= 45_000 ? "completed" : "pending" } as JobEnvelope
      },
    }
    //#when
    const out = await pollJobs({ client, jobIds: ["a", "b"], intervalMs: 15_000, timeoutMs: 600_000, sleep: c.sleep, now: c.now })
    //#then
    expect(out.map((o) => o.state)).toEqual(["completed", "completed"])
    expect(aFetches).toBe(1)
  })

  test("reports a timeout instead of a clean result when the deadline passes", async () => {
    //#given a job that never finishes
    const c = clock()
    //#when
    const out = await pollJobs({ client: scripted({}), jobIds: ["stuck"], intervalMs: 15_000, timeoutMs: 60_000, sleep: c.sleep, now: c.now })
    //#then
    expect(out).toEqual([{ state: "timeout", jobId: "stuck" }])
  })

  test("surfaces a failed job with its error", async () => {
    //#given
    const c = clock()
    const client = scripted({ a: [{ status: "failed", error: "bad input" }] })
    //#when
    const out = await pollJobs({ client, jobIds: ["a"], intervalMs: 15_000, timeoutMs: 600_000, sleep: c.sleep, now: c.now })
    //#then
    expect(out[0]).toEqual({ state: "failed", jobId: "a", error: "bad input" })
  })

  test("survives transient transport errors and keeps polling", async () => {
    //#given the first check throws
    const c = clock()
    let calls = 0
    const client = {
      fetchJob: async () => {
        if (calls++ === 0) throw new Error("ECONNRESET")
        return { status: "completed" } as JobEnvelope
      },
    }
    //#when
    const out = await pollJobs({ client, jobIds: ["a"], intervalMs: 15_000, timeoutMs: 600_000, sleep: c.sleep, now: c.now })
    //#then
    expect(out[0]?.state).toBe("completed")
  })

  test("treats an auth failure as terminal rather than retrying until the deadline", async () => {
    //#given
    const c = clock()
    const client = {
      fetchJob: async (): Promise<JobEnvelope> => {
        throw new Error("Cyclopt rejected the credential (HTTP 401). Check that CYCLOPT_API_TOKEN is valid")
      },
    }
    //#when
    const out = await pollJobs({ client, jobIds: ["a"], intervalMs: 15_000, timeoutMs: 600_000, sleep: c.sleep, now: c.now })
    //#then
    expect(out[0]?.state).toBe("failed")
    expect(c.sleeps).toHaveLength(1)
  })

  test("stops promptly when aborted", async () => {
    //#given
    const c = clock()
    const ac = new AbortController()
    const client = scripted({})
    //#when abort fires during the first sleep
    const out = await pollJobs({
      client,
      jobIds: ["a"],
      intervalMs: 15_000,
      timeoutMs: 600_000,
      signal: ac.signal,
      sleep: async (ms) => {
        await c.sleep(ms)
        ac.abort()
      },
      now: c.now,
    })
    //#then
    expect(out).toEqual([{ state: "aborted", jobId: "a" }])
  })
})
