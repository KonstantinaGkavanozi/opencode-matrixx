import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { buildExtractArgv, extractArchive, parseUnzipArgs } from "../../src/shared/archive-extractor"
import { cleanupTempDir, createTempDir } from "../../src/shared/test-utils/fs"
import { NO_CAPABILITIES } from "../../src/shared/test-utils/platform"

describe("buildExtractArgv", () => {
  it("#given linux #then uses unzip -o -d", () => {
    expect(buildExtractArgv("a.zip", "out", "linux", NO_CAPABILITIES)?.argv).toEqual(["unzip", "-o", "a.zip", "-d", "out"])
  })

  it("#given win32 with tar #then prefers tar", () => {
    const r = buildExtractArgv("a.zip", "out", "win32", { ...NO_CAPABILITIES, hasTar: true, hasPwsh: true, winBuild: 22631 })
    expect(r?.argv[0]).toMatch(/tar(\.exe)?$/i)
    expect(r?.argv.slice(1)).toEqual(["-xf", "a.zip", "-C", "out"])
    expect(r?.resolvedWith).toBe("tar(build 22631)")
  })

  it("#given win32 without tar but pwsh #then uses pwsh over powershell", () => {
    const r = buildExtractArgv("a.zip", "out", "win32", { ...NO_CAPABILITIES, hasPwsh: true, hasPowerShell: true })
    expect(r?.argv[0]).toBe("pwsh")
  })

  it("#given win32 path with a quote #then escapes it for PowerShell", () => {
    const r = buildExtractArgv("it's.zip", "out", "win32", { ...NO_CAPABILITIES, hasPowerShell: true })
    expect(r?.argv[2]).toContain("'it''s.zip'")
  })

  it("#given win32 with no tools #then null", () => {
    expect(buildExtractArgv("a.zip", "out", "win32", NO_CAPABILITIES)).toBeNull()
  })
})

describe("extractArchive", () => {
  it("#given win32 with no tools #when extracting #then throws a meaningful error", async () => {
    const err = await extractArchive("a.zip", "out", { platform: "win32", capabilities: NO_CAPABILITIES }).catch((e) => e)
    expect(err.message).toContain("no extraction tool found")
  })

  it("#given a real zip #when extracting #then contents land in dest", async () => {
    //#given
    const dir = createTempDir()
    try {
      const zip = join(dir, "a.zip")
      const src = join(dir, "src")
      await Bun.write(join(src, "hello.txt"), "hi")
      // bsdtar (Windows/macOS) can write zips; GNU tar cannot, so skip when the host can't build one.
      const mk = Bun.spawnSync(["tar", "-a", "-cf", zip, "-C", src, "hello.txt"])
      if (mk.exitCode !== 0 || !existsSync(zip)) return
      //#when
      await extractArchive(zip, join(dir, "out"))
      //#then
      expect(readFileSync(join(dir, "out", "hello.txt"), "utf-8")).toBe("hi")
    } finally {
      cleanupTempDir(dir)
    }
  })
})

describe("parseUnzipArgs", () => {
  it("#given unzip -o a.zip -d out #then extracts archive and dest", () => {
    expect(parseUnzipArgs(["unzip", "-o", "a.zip", "-d", "out"])).toEqual({ archive: "a.zip", dest: "out" })
  })

  it("#given no -d #then dest defaults to cwd", () => {
    expect(parseUnzipArgs(["unzip", "a.zip"])).toEqual({ archive: "a.zip", dest: "." })
  })
})
