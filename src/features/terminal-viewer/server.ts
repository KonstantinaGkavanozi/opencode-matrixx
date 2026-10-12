import { z } from "zod"
import type { TerminalService } from "../terminal-session/service"
import { viewerAsset } from "./assets"
import { VIEWER_PAGE } from "./page"

const RequestSchema = z.object({
  id: z.string().optional(), data: z.string().max(65536).optional(),
  cols: z.number().int().optional(), rows: z.number().int().optional(),
})

/** A bearer token grants human control of one owner's terminals, never all projects. */
export class TerminalViewer {
  private server?: ReturnType<typeof Bun.serve>
  private readonly tokens = new Map<string, string>()
  constructor(private readonly terminals: TerminalService) {}
  open(owner: string): string {
    if (!this.terminals.config.enabled || !this.terminals.config.viewer) throw new Error("Set terminal.enabled and terminal.viewer to true to use the viewer")
    if (!this.server) this.server = Bun.serve({
      hostname: "127.0.0.1", port: 0, maxRequestBodySize: 131072,
      fetch: request => this.handle(request),
    })
    const token = crypto.randomUUID() + crypto.randomUUID()
    this.tokens.set(token, owner)
    return `${this.server.url.origin}/#${token}`
  }
  revoke(owner: string): void { for (const [token, value] of this.tokens) if (value === owner) this.tokens.delete(token) }
  private async handle(request: Request): Promise<Response> {
    const response = await this.route(request).catch(error => Response.json({ error: error instanceof Error ? error.message : "Terminal request failed" }, { status: 400 }))
    response.headers.set("Cache-Control", "no-store")
    response.headers.set("X-Content-Type-Options", "nosniff")
    response.headers.set("Referrer-Policy", "no-referrer")
    response.headers.set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
    return response
  }
  private async route(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const origin = this.server?.url.origin
    if (url.origin !== origin || request.headers.get("host") !== new URL(origin ?? url).host) return new Response("Forbidden host", { status: 403 })
    if (request.method === "GET" && url.pathname === "/") return new Response(VIEWER_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    if (request.method === "GET" && url.pathname === "/terminal.js") return viewerAsset("terminal.js")
    if (request.method === "GET" && url.pathname === "/terminal.css") return viewerAsset("terminal.css")
    const owner = this.tokens.get(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "")
    const requestOrigin = request.headers.get("origin")
    const sameOrigin = requestOrigin === origin || (!requestOrigin && request.headers.get("sec-fetch-site") === "same-origin")
    if (!owner || !sameOrigin) return new Response("Forbidden", { status: 403 })
    if (request.method === "GET") {
      const id = url.searchParams.get("id") ?? ""
      if (url.pathname === "/api/list") return Response.json(this.terminals.list(owner))
      if (url.pathname === "/api/read") return Response.json(this.terminals.read(owner, id, Number(url.searchParams.get("cursor") ?? 0)))
      if (url.pathname === "/api/snapshot") return Response.json(await this.terminals.snapshot(owner, id))
    }
    if (request.method !== "POST") return new Response("Not found", { status: 404 })
    const body = RequestSchema.parse(await request.json())
    const id = body.id ?? ""
    switch (url.pathname) {
      case "/api/create": {
        const executable = process.platform === "win32" ? Bun.which("pwsh") ?? Bun.which("powershell") : Bun.which("bash") ?? Bun.which("sh")
        if (!executable) throw new Error("No interactive shell found")
        return Response.json(await this.terminals.create(owner, { executable, args: process.platform === "win32" ? ["-NoLogo", "-NoProfile"] : [], title: "Shell" }))
      }
      case "/api/write": this.terminals.write(owner, id, body.data ?? ""); break
      case "/api/resize": this.terminals.resize(owner, id, body.cols ?? 80, body.rows ?? 24); break
      case "/api/interrupt": this.terminals.interrupt(owner, id); break
      case "/api/close": await this.terminals.close(owner, id); break
      default: return new Response("Not found", { status: 404 })
    }
    return Response.json({ ok: true })
  }
  dispose(): void { this.tokens.clear(); this.server?.stop(true); this.server = undefined }
}
