import { describe, expect, it } from "bun:test"
import { getTmuxUnavailableMessage } from "../../../src/shared/tmux/tmux-compat"

describe("getTmuxUnavailableMessage", () => {
  it("#given tmux found #then null on every platform", () => {
    for (const p of ["linux", "darwin", "win32"] as const) {
      expect(getTmuxUnavailableMessage(p, true)).toBeNull()
    }
  })

  it("#given win32 without tmux #then explains native Windows and suggests alternatives", () => {
    const msg = getTmuxUnavailableMessage("win32", false)
    expect(msg).toContain("native Windows")
    expect(msg).toContain("WSL")
  })

  it("#given linux without tmux #then asks to install tmux", () => {
    expect(getTmuxUnavailableMessage("linux", false)).toContain("Install tmux")
  })
})
