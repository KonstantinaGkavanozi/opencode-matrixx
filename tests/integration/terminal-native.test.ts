import { expect, it } from "bun:test"
import { TerminalService } from "../../src/features/terminal-session/service"

it("native terminal supports input, resize, ownership, and teardown", async () => {
  //#given a real Bun PTY (ConPTY on Windows)
  const service = new TerminalService(process.cwd(), { enabled: true })
  try {
    const session = await service.create("owner", {
      executable: process.execPath,
      args: ["-e", "process.stdin.setRawMode(true); console.log('READY:'+process.stdout.isTTY); process.stdout.on('resize',()=>console.log('SIZE:'+process.stdout.columns)); process.stdin.on('data',()=>{console.log('INPUT_OK'); process.exit(7)})"],
      cols: 80, rows: 24,
    })
    await service.waitFor("owner", session.id, "READY:true", 10000)
    //#when another session tries to write
    expect(() => service.write("other", session.id, "x")).toThrow("owned")
    service.resize("owner", session.id, 101, 30)
    await service.waitFor("owner", session.id, "SIZE:101", 10000)
    service.write("owner", session.id, "x")
    await service.waitFor("owner", session.id, "INPUT_OK", 10000)
    //#then the real exit status is retained
    await service.waitForExit("owner", session.id, 10000)
    expect(service.info("owner", session.id).exitCode).toBe(7)
    await service.close("owner", session.id)
    await service.close("owner", session.id)
  } finally { await service.dispose() }
}, 20000)
