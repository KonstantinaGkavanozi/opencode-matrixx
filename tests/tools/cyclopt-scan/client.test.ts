import { describe, expect, test } from "bun:test"
import { CycloptHttpError, createCycloptClient, parseRpcBody, unwrapToolResult } from "../../../src/tools/cyclopt-scan/client"

const endpoint = { baseUrl: "https://cyclopt.test/mcp", token: "sekret" }

type Call = { body: Record<string, unknown>; headers: Record<string, string> }

/** Fake Cyclopt server. `handler` returns [status, payload, headers?] per JSON-RPC method. */
function fakeServer(handler: (method: string, body: Record<string, unknown>, n: number) => [number, unknown, Record<string, string>?]) {
  const calls: Call[] = []
  const counts: Record<string, number> = {}
  const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({ body, headers: init?.headers as Record<string, string> })
    const method = String(body.method)
    counts[method] = (counts[method] ?? 0) + 1
    const [status, payload, headers] = handler(method, body, counts[method] as number)
    const text = typeof payload === "string" ? payload : JSON.stringify(payload)
    return new Response(text, { status, headers: { "content-type": "application/json", ...(headers ?? {}) } })
  }
  return { calls, fetchImpl }
}

const toolResult = (payload: unknown) => ({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } })

describe("parseRpcBody", () => {
  test("parses plain JSON", () => {
    //#then
    expect(parseRpcBody("application/json", '{"a":1}')).toEqual({ a: 1 })
  })

  test("parses the last JSON data frame of an SSE stream, ignoring keep-alives", () => {
    //#given
    const sse = 'event: ping\ndata: not json\n\nevent: message\ndata: {"id":2,"result":{}}\n\n'
    //#then
    expect(parseRpcBody("text/event-stream", sse)).toEqual({ id: 2, result: {} })
  })

  test("throws on an SSE stream with no JSON", () => {
    //#then
    expect(() => parseRpcBody("text/event-stream", "data: nope\n")).toThrow()
  })
})

describe("unwrapToolResult", () => {
  test("parses JSON tool text", () => {
    //#then
    expect(unwrapToolResult(toolResult({ jobId: "j1" }))).toEqual({ jobId: "j1" })
  })

  test("prefers structuredContent when present", () => {
    //#then
    expect(unwrapToolResult({ result: { structuredContent: { a: 1 }, content: [] } })).toEqual({ a: 1 })
  })

  test("wraps non-JSON text instead of throwing", () => {
    //#then
    expect(unwrapToolResult({ result: { content: [{ type: "text", text: "hello" }] } })).toEqual({ message: "hello" })
  })

  test("throws on isError and on JSON-RPC errors", () => {
    //#then
    expect(() => unwrapToolResult({ result: { isError: true, content: [{ type: "text", text: "boom" }] } })).toThrow("boom")
    expect(() => unwrapToolResult({ error: { message: "nope" } })).toThrow("nope")
  })
})

describe("createCycloptClient", () => {
  const files = [{ filename: "a.js", content: "x" }]

  test("initialises the session once, then calls the tool with bearer auth and the session id", async () => {
    //#given
    const srv = fakeServer((method) => {
      if (method === "initialize") return [200, { jsonrpc: "2.0", id: 1, result: {} }, { "mcp-session-id": "S1" }]
      if (method === "notifications/initialized") return [202, ""]
      return [200, toolResult({ jobId: "job-1", status: "pending" })]
    })
    const client = createCycloptClient(endpoint, { fetchImpl: srv.fetchImpl })
    //#when
    const id1 = await client.enqueue({ tool: "analyze_file", analyzers: ["sast"], files })
    const id2 = await client.enqueue({ tool: "analyze_file", files })
    //#then
    expect([id1, id2]).toEqual(["job-1", "job-1"])
    expect(srv.calls.filter((c) => c.body.method === "initialize")).toHaveLength(1)
    const toolCall = srv.calls.find((c) => c.body.method === "tools/call")
    expect(toolCall?.headers.Authorization).toBe("Bearer sekret")
    expect(toolCall?.headers["Mcp-Session-Id"]).toBe("S1")
    expect(toolCall?.body.params).toEqual({ name: "analyze_file", arguments: { files, analyzers: ["sast"] } })
  })

  test("translates camelCase jobId from enqueue into snake_case job_id for polling", async () => {
    //#given
    const srv = fakeServer((method, body) => {
      if (method === "initialize") return [200, { jsonrpc: "2.0", id: 1, result: {} }]
      if (method === "notifications/initialized") return [202, ""]
      const params = body.params as { name: string; arguments: Record<string, unknown> }
      if (params.name === "analyze_file") return [200, toolResult({ jobId: "job-9", status: "pending" })]
      return [200, toolResult({ jobId: "job-9", status: "completed" })]
    })
    const client = createCycloptClient(endpoint, { fetchImpl: srv.fetchImpl })
    //#when
    const jobId = await client.enqueue({ tool: "analyze_file", files })
    const job = await client.fetchJob(jobId)
    //#then
    const poll = srv.calls.filter((c) => c.body.method === "tools/call").at(-1)
    expect(poll?.body.params).toEqual({ name: "check_analysis_job", arguments: { job_id: "job-9" } })
    expect(job.status).toBe("completed")
  })

  test("retries 429 and 5xx with backoff, then succeeds", async () => {
    //#given the first tools/call is rate limited, then a 503
    const sleeps: number[] = []
    const srv = fakeServer((method, _b, n) => {
      if (method === "initialize") return [200, { jsonrpc: "2.0", id: 1, result: {} }]
      if (method === "notifications/initialized") return [202, ""]
      if (n === 1) return [429, "slow down"]
      if (n === 2) return [503, "down"]
      return [200, toolResult({ jobId: "ok" })]
    })
    const client = createCycloptClient(endpoint, { fetchImpl: srv.fetchImpl, sleep: async (ms) => void sleeps.push(ms) })
    //#when
    const id = await client.enqueue({ tool: "analyze_file", files })
    //#then
    expect(id).toBe("ok")
    expect(sleeps).toHaveLength(2)
    expect(sleeps[1]).toBeGreaterThan(sleeps[0] as number)
  })

  test("gives up after bounded retries", async () => {
    //#given
    const srv = fakeServer((method) => {
      if (method === "initialize") return [200, { jsonrpc: "2.0", id: 1, result: {} }]
      if (method === "notifications/initialized") return [202, ""]
      return [500, "always down"]
    })
    const client = createCycloptClient(endpoint, { fetchImpl: srv.fetchImpl, sleep: async () => {} })
    //#then
    await expect(client.enqueue({ tool: "analyze_file", files })).rejects.toBeInstanceOf(CycloptHttpError)
    expect(srv.calls.filter((c) => c.body.method === "tools/call")).toHaveLength(3)
  })

  test("reports a 401 with token guidance and does not retry it", async () => {
    //#given
    const srv = fakeServer(() => [401, "unauthorized"])
    const client = createCycloptClient(endpoint, { fetchImpl: srv.fetchImpl, sleep: async () => {} })
    //#when
    const err = await client.enqueue({ tool: "analyze_file", files }).catch((e: Error) => e)
    //#then
    expect(String((err as Error).message)).toContain("CYCLOPT_API_TOKEN")
    expect(srv.calls).toHaveLength(1)
  })

  test("rejects when enqueue returns no job id", async () => {
    //#given
    const srv = fakeServer((method) => {
      if (method === "initialize") return [200, { jsonrpc: "2.0", id: 1, result: {} }]
      if (method === "notifications/initialized") return [202, ""]
      return [200, toolResult({ status: "pending" })]
    })
    const client = createCycloptClient(endpoint, { fetchImpl: srv.fetchImpl })
    //#then
    await expect(client.enqueue({ tool: "analyze_file", files })).rejects.toThrow("no job id")
  })

  test("never leaks the token into error messages", async () => {
    //#given
    const srv = fakeServer(() => [500, "boom"])
    const client = createCycloptClient(endpoint, { fetchImpl: srv.fetchImpl, sleep: async () => {} })
    //#when
    const err = await client.enqueue({ tool: "analyze_file", files }).catch((e: Error) => e)
    //#then
    expect(String((err as Error).message)).not.toContain("sekret")
  })
})
