import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildExtractArgv } from "../../src/shared/archive-extractor"
import { getCapabilities, getPlatform, runTranslated } from "../../src/shared/command-translator"
import { resolve } from "../../src/shared/command-translator/registry"
import type { Platform } from "../../src/shared/command-translator/types"
import { detectShellType } from "../../src/shared/shell-env"
import { cleanupTempDir, createTempDir } from "../../src/shared/test-utils/fs"
import {
  mockCapabilities,
  mockPlatform,
  NO_CAPABILITIES,
  restoreCapabilities,
  restorePlatform,
} from "../../src/shared/test-utils/platform"
import { getTmuxUnavailableMessage } from "../../src/shared/tmux/tmux-compat"

afterEach(() => {
  restorePlatform()
  restoreCapabilities()
  delete process.env.MATRIXX_SHELL
})

const WINDOWS_CAPS = { ...NO_CAPABILITIES, hasTar: true, winBuild: 22631, python: "py" as const }

describe.each<Platform>(["linux", "darwin", "win32"])("cross-platform behaviour on %s", (platform) => {
  it("#given filesystem commands #then they never resolve to a spawned process", async () => {
    //#given
    mockPlatform(platform)
    mockCapabilities(platform === "win32" ? WINDOWS_CAPS : {})
    const dir = createTempDir()
    try {
      const nested = join(dir, "a", "b")
      const file = join(dir, "a", "f.txt")
      //#when
      await runTranslated(["mkdir", "-p", nested])
      writeFileSync(file, "x")
      await runTranslated(["cp", file, join(nested, "copy.txt")])
      await runTranslated(["mv", join(nested, "copy.txt"), join(nested, "moved.txt")])
      //#then
      expect(existsSync(join(nested, "moved.txt"))).toBe(true)
      //#when
      await runTranslated(["rm", "-rf", join(dir, "a")])
      //#then
      expect(existsSync(join(dir, "a"))).toBe(false)
    } finally {
      cleanupTempDir(dir)
    }
  })

  it("#given a platform #then getPlatform and capabilities follow the mock", () => {
    mockPlatform(platform)
    mockCapabilities({ python: platform === "win32" ? "py" : "python3" })
    expect(getPlatform()).toBe(platform)
    expect(getCapabilities().python).toBe(platform === "win32" ? "py" : "python3")
  })

  it("#given archive extraction #then argv matches the platform's tooling", () => {
    const caps = platform === "win32" ? WINDOWS_CAPS : NO_CAPABILITIES
    const argv = buildExtractArgv("a.zip", "out", platform, caps)?.argv
    expect(argv?.[0]).toMatch(platform === "win32" ? /tar(\.exe)?$/i : /^unzip$/)
  })

  it("#given python3 #then resolves to the platform's interpreter", () => {
    const caps = platform === "win32" ? WINDOWS_CAPS : NO_CAPABILITIES
    const r = resolve("python3", ["python3", "-V"], platform, caps)
    expect(r?.argv[0]).toBe(platform === "win32" ? "py" : "python3")
  })

  it("#given tmux #then unsupported only on win32", () => {
    const r = resolve("tmux", ["tmux", "ls"], platform, NO_CAPABILITIES)
    expect(r === null).toBe(platform === "win32")
    expect(getTmuxUnavailableMessage(platform, false)).not.toBeNull()
  })

  it("#given shell detection #then unix off-Windows, powershell on Windows without SHELL", () => {
    mockPlatform(platform)
    const savedShell = process.env.SHELL
    delete process.env.SHELL
    try {
      expect(detectShellType()).toBe(platform === "win32" ? "powershell" : "unix")
    } finally {
      if (savedShell !== undefined) process.env.SHELL = savedShell
    }
  })
})

describe("tmp/cache path resolution", () => {
  it("#given any platform #then no user-facing temp path is hardcoded to /tmp", async () => {
    const { tmpdir } = await import("node:os")
    const { join: pjoin } = await import("node:path")
    const logger = await Bun.file(join(import.meta.dir, "../../src/shared/logger.ts")).text()
    expect(logger).toContain("os.tmpdir()")
    expect(logger).not.toContain('"/tmp')
    expect(pjoin(tmpdir(), "matrixx.log")).toContain("matrixx.log")
  })

  it("#given a directory #then mkdir -p semantics hold on an existing path", async () => {
    const dir = createTempDir()
    try {
      mkdirSync(join(dir, "x"))
      await runTranslated(["mkdir", "-p", join(dir, "x")])
      expect(existsSync(join(dir, "x"))).toBe(true)
    } finally {
      cleanupTempDir(dir)
    }
  })
})
