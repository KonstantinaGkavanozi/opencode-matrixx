import type { CycloptEndpoint } from "../../mcp/cyclopt-endpoint"
import { MAX_HTTP_ATTEMPTS, REQUEST_TIMEOUT_MS, RETRY_BASE_DELAY_MS } from "./constants"
import type { JobEnvelope, PlannedJob } from "./types"

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type ClientDeps = {
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

export class CycloptHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "CycloptHttpError"
  }
}

export type CycloptClient = {
  enqueue(job: PlannedJob, signal?: AbortSignal): Promise<string>
  fetchJob(jobId: string, signal?: AbortSignal): Promise<JobEnvelope>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function describeStatus(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return `Cyclopt rejected the credential (HTTP ${status}). Check that CYCLOPT_API_TOKEN is valid and not expired.`
  }
  return `Cyclopt request failed (HTTP ${status}): ${body.slice(0, 300)}`
}

/** Extract the JSON-RPC message from either a plain JSON body or an SSE stream. */
export function parseRpcBody(contentType: string, text: string): Record<string, unknown> {
  if (contentType.includes("text/event-stream")) {
    let last: Record<string, unknown> | undefined
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue
      const payload = line.slice(5).trim()
      if (!payload) continue
      try {
        last = JSON.parse(payload) as Record<string, unknown>
      } catch {
        // Ignore non-JSON keep-alive frames.
      }
    }
    if (!last) throw new Error("Cyclopt returned an SSE stream with no JSON message")
    return last
  }
  return JSON.parse(text) as Record<string, unknown>
}

/** Unwrap an MCP tools/call result into the JSON payload the tool produced. */
export function unwrapToolResult(rpc: Record<string, unknown>): Record<string, unknown> {
  if (rpc.error) {
    const err = rpc.error as { message?: string }
    throw new Error(`Cyclopt JSON-RPC error: ${err.message ?? JSON.stringify(rpc.error)}`)
  }
  const result = (rpc.result ?? {}) as {
    isError?: boolean
    structuredContent?: Record<string, unknown>
    content?: { type?: string; text?: string }[]
  }
  const text = result.content?.find((c) => c.type === "text")?.text ?? ""
  if (result.isError) throw new Error(`Cyclopt tool error: ${text.slice(0, 500)}`)
  if (result.structuredContent) return result.structuredContent
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { message: text }
  }
}

export function createCycloptClient(endpoint: CycloptEndpoint, deps: ClientDeps = {}): CycloptClient {
  const fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init))
  const sleep = deps.sleep ?? defaultSleep
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS
  let nextId = 1
  let sessionId: string | undefined
  let initialised: Promise<void> | undefined

  async function post(body: unknown, signal?: AbortSignal): Promise<{ text: string; contentType: string; res: Response }> {
    for (let attempt = 1; ; attempt++) {
      const timeout = AbortSignal.timeout(timeoutMs)
      const res = await fetchImpl(endpoint.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${endpoint.token}`,
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
      const text = await res.text()
      const retryable = res.status === 429 || res.status >= 500
      if (retryable && attempt < MAX_HTTP_ATTEMPTS) {
        const retryAfter = Number(res.headers.get("retry-after"))
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
        await sleep(delay)
        continue
      }
      if (!res.ok) throw new CycloptHttpError(res.status, describeStatus(res.status, text))
      return { text, contentType: res.headers.get("content-type") ?? "", res }
    }
  }

  function ensureSession(signal?: AbortSignal): Promise<void> {
    initialised ??= (async () => {
      const init = await post(
        {
          jsonrpc: "2.0",
          id: nextId++,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "opencode-matrixx", version: "1.0.0" },
          },
        },
        signal,
      )
      sessionId = init.res.headers.get("mcp-session-id") ?? undefined
      // Notification: no id, server replies 202 with an empty body.
      await post({ jsonrpc: "2.0", method: "notifications/initialized" }, signal)
    })().catch((err) => {
      initialised = undefined
      throw err
    })
    return initialised
  }

  async function callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    await ensureSession(signal)
    const { text, contentType } = await post(
      { jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } },
      signal,
    )
    return unwrapToolResult(parseRpcBody(contentType, text))
  }

  return {
    async enqueue(job, signal) {
      const args: Record<string, unknown> = { files: job.files }
      if (job.analyzers) args.analyzers = job.analyzers
      const payload = await callTool(job.tool, args, signal)
      // Enqueue returns camelCase `jobId`; check_analysis_job wants snake_case `job_id`.
      const jobId = (payload.jobId ?? payload.job_id) as string | undefined
      if (!jobId) throw new Error(`Cyclopt enqueue returned no job id: ${JSON.stringify(payload).slice(0, 300)}`)
      return jobId
    },
    async fetchJob(jobId, signal) {
      const payload = await callTool("check_analysis_job", { job_id: jobId }, signal)
      return payload as JobEnvelope
    },
  }
}
