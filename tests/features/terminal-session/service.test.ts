import { expect, it } from "bun:test"
import { TerminalService } from "../../../src/features/terminal-session/service"

it("rejects disabled sessions and invalid dimensions before spawning", async () => {
  //#given a disabled terminal manager
  const disabled = new TerminalService(process.cwd())
  const enabled = new TerminalService(process.cwd(), { enabled: true })
  try {
    //#when callers request execution or excessive screen allocation
    await expect(disabled.create("owner", { executable: "missing" })).rejects.toThrow("disabled")
    await expect(enabled.create("owner", { executable: "missing", cols: 100000 })).rejects.toThrow("dimensions")
    //#then no process was admitted
    expect(enabled.list("owner")).toEqual([])
  } finally { await disabled.dispose(); await enabled.dispose() }
})
