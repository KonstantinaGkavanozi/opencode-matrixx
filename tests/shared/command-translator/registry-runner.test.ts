import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { resolve } from "../../../src/shared/command-translator/registry"
import { emulate, runTranslated } from "../../../src/shared/command-translator/runner"
import { MissingBinaryError, UnsupportedCommandError } from "../../../src/shared/command-translator/types"
import { cleanupTempDir, createTempDir } from "../../../src/shared/test-utils/fs"
import { NO_CAPABILITIES } from "../../../src/shared/test-utils/platform"

const tmpDirs: string[] = []
function tempDir(): string {
  const dir = createTempDir()
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) cleanupTempDir(d)
})

describe("registry.resolve", () => {
  it("#given rm on win32 #when resolved #then it is emulated, not spawned", () => {
    //#when
    const r = resolve("rm", ["rm", "-rf", "x"], "win32", NO_CAPABILITIES)
    //#then
    expect(r?.strategy).toBe("emulated")
  })

  it("#given win32 with py only #when resolving python3 #then uses py", () => {
    const r = resolve("python3", ["python3", "--version"], "win32", { ...NO_CAPABILITIES, python: "py" })
    expect(r?.argv).toEqual(["py", "--version"])
  })

  it("#given win32 without python #when resolving python3 #then null", () => {
    expect(resolve("python3", ["python3"], "win32", NO_CAPABILITIES)).toBeNull()
  })

  it("#given win32 with tar #when resolving unzip #then uses tar with dest", () => {
    const r = resolve("unzip", ["unzip", "-o", "a.zip", "-d", "out"], "win32", { ...NO_CAPABILITIES, hasTar: true })
    expect(r?.argv[0]).toMatch(/tar(\.exe)?$/i)
    expect(r?.argv.slice(1)).toEqual(["-xf", "a.zip", "-C", "out"])
  })

  it("#given win32 with only powershell #when resolving unzip #then uses Expand-Archive", () => {
    const r = resolve("unzip", ["unzip", "a.zip", "-d", "out"], "win32", { ...NO_CAPABILITIES, hasPowerShell: true })
    expect(r?.argv[0]).toBe("powershell")
    expect(r?.argv[2]).toContain("Expand-Archive -Path 'a.zip' -DestinationPath 'out'")
  })

  it("#given linux #when resolving unzip #then passes through to unzip", () => {
    const r = resolve("unzip", ["unzip", "-o", "a.zip", "-d", "out"], "linux", NO_CAPABILITIES)
    expect(r?.argv).toEqual(["unzip", "-o", "a.zip", "-d", "out"])
  })

  it("#given linux #when resolving tmux #then native pass-through", () => {
    expect(resolve("tmux", ["tmux", "ls"], "linux", NO_CAPABILITIES)?.strategy).toBe("native")
  })

  it("#given win32 #when resolving tmux #then null", () => {
    expect(resolve("tmux", ["tmux", "ls"], "win32", NO_CAPABILITIES)).toBeNull()
  })
})

describe("runTranslated", () => {
  it("#given tmux on win32 #when run #then throws UnsupportedCommandError suggesting interactive-bash", async () => {
    const err = await runTranslated(["tmux", "ls"], { platform: "win32", capabilities: NO_CAPABILITIES }).catch((e) => e)
    expect(err).toBeInstanceOf(UnsupportedCommandError)
    expect(err.message).toContain("interactive-bash")
  })

  it("#given python3 on win32 without python #when run #then throws MissingBinaryError", async () => {
    const err = await runTranslated(["python3", "-V"], { platform: "win32", capabilities: NO_CAPABILITIES }).catch((e) => e)
    expect(err).toBeInstanceOf(MissingBinaryError)
  })

  it("#given rm -rf on win32 #when run #then the directory is removed via fs, without spawning", async () => {
    //#given
    const dir = tempDir()
    const target = join(dir, "victim")
    mkdirSync(join(target, "nested"), { recursive: true })
    //#when
    await runTranslated(["rm", "-rf", target], { platform: "win32", capabilities: NO_CAPABILITIES })
    //#then
    expect(existsSync(target)).toBe(false)
  })

  it("#given mkdir -p on win32 #when run #then nested dirs exist", async () => {
    const dir = tempDir()
    const nested = join(dir, "a", "b", "c")
    await runTranslated(["mkdir", "-p", nested], { platform: "win32", capabilities: NO_CAPABILITIES })
    expect(existsSync(nested)).toBe(true)
  })

  it("#given unregistered command #when run #then passes through to spawn", async () => {
    const err = await runTranslated(["definitely-not-a-real-binary-xyz"]).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(UnsupportedCommandError)
  })
})

describe("emulate", () => {
  it("#given cp file into existing dir #when emulated #then lands inside the dir", () => {
    const dir = tempDir()
    const src = join(dir, "f.txt")
    writeFileSync(src, "data")
    mkdirSync(join(dir, "dest"))
    emulate("cp", [src, join(dir, "dest")])
    expect(readFileSync(join(dir, "dest", "f.txt"), "utf-8")).toBe("data")
  })

  it("#given cp -r dir to new path #when emulated #then copies recursively", () => {
    const dir = tempDir()
    mkdirSync(join(dir, "src", "sub"), { recursive: true })
    writeFileSync(join(dir, "src", "sub", "f.txt"), "x")
    emulate("cp", ["-r", join(dir, "src"), join(dir, "copy")])
    expect(readFileSync(join(dir, "copy", "sub", "f.txt"), "utf-8")).toBe("x")
  })

  it("#given mv file into existing dir #when emulated #then moved inside", () => {
    const dir = tempDir()
    const src = join(dir, "f.txt")
    writeFileSync(src, "m")
    mkdirSync(join(dir, "dest"))
    emulate("mv", [src, join(dir, "dest")])
    expect(existsSync(src)).toBe(false)
    expect(readFileSync(join(dir, "dest", "f.txt"), "utf-8")).toBe("m")
  })

  it("#given rm of a missing path #when emulated #then does not throw", () => {
    expect(() => emulate("rm", ["-rf", join(tempDir(), "nope")])).not.toThrow()
  })
})
