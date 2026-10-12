import { expect, it } from "bun:test"
import { TerminalService } from "../../../src/features/terminal-session/service"
import { TerminalViewer } from "../../../src/features/terminal-viewer/server"

it("viewer requires an owner token and rejects cross-origin mutation", async () => {
  //#given an owner-scoped loopback viewer
  const service = new TerminalService(process.cwd(), { enabled: true, viewer: true })
  const viewer = new TerminalViewer(service)
  try {
    const link = new URL(viewer.open("owner"))
    const headers = { Authorization: `Bearer ${link.hash.slice(1)}`, Origin: link.origin }
    //#when requests arrive without authority or from another website
    expect((await fetch(`${link.origin}/api/list`)).status).toBe(403)
    expect((await fetch(`${link.origin}/api/list`, { headers: { ...headers, Origin: "https://evil.example" } })).status).toBe(403)
    //#then only the authenticated owner can inspect their sessions
    expect(await (await fetch(`${link.origin}/api/list`, { headers })).json()).toEqual([])
    viewer.revoke("owner")
    expect((await fetch(`${link.origin}/api/list`, { headers })).status).toBe(403)
  } finally { viewer.dispose(); await service.dispose() }
})
