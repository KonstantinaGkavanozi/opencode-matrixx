import { describe, expect, it } from "bun:test"
import { buildShellArgv, executeCommand } from "../../../src/shared/command-executor/execute-command"

describe("buildShellArgv", () => {
  it("#given unix shell #then runs through sh -c", () => {
    const argv = buildShellArgv("echo hi", "unix")
    expect(argv.at(-2)).toBe("-c")
    expect(argv.at(-1)).toBe("echo hi")
    expect(argv[0]).toMatch(/(^|[\\/])(sh|bash)(\.exe)?$/)
  })

  it("#given powershell #then runs through -Command", () => {
    const argv = buildShellArgv("Get-Date", "powershell")
    expect(argv[0]).toMatch(/^(pwsh|powershell)$/)
    expect(argv).toContain("-NoProfile")
    expect(argv.slice(-2)).toEqual(["-Command", "Get-Date"])
  })

  it("#given cmd #then runs through cmd /c", () => {
    expect(buildShellArgv("dir", "cmd")).toEqual(["cmd", "/c", "dir"])
  })
})

describe("executeCommand", () => {
  it("#given a successful command #then returns trimmed stdout", async () => {
    expect(await executeCommand(`"${process.execPath}" -e "console.log('hello')"`)).toBe("hello")
  })

  it("#given a command writing to stderr #then appends a stderr block", async () => {
    const out = await executeCommand(`"${process.execPath}" -e "console.error('oops')"`)
    expect(out).toBe("[stderr: oops]")
  })

  it("#given a failing command with no output #then reports the exit code", async () => {
    const out = await executeCommand(`"${process.execPath}" -e "process.exit(3)"`)
    expect(out).toContain("exited with code 3")
  })

  it("#given a missing binary #then returns an error string instead of throwing", async () => {
    const out = await executeCommand("definitely-not-a-real-binary-xyz")
    expect(out).toContain("[stderr:")
  })
})
