import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { getCapabilities } from "../../../src/shared/command-translator/capabilities"
import { cleanupTempDir, createTempDir, createTempFile } from "../../../src/shared/test-utils/fs"
import {
  mockCapabilities,
  mockPlatform,
  restoreCapabilities,
  restorePlatform,
} from "../../../src/shared/test-utils/platform"

const realPlatform = process.platform

afterEach(() => {
  restorePlatform()
  restoreCapabilities()
})

describe("mockPlatform", () => {
  it("#given win32 mock #when reading process.platform #then reports win32", () => {
    //#given
    mockPlatform("win32")
    //#then
    expect(process.platform).toBe("win32")
  })

  it("#given a mock #when restored #then original platform returns", () => {
    //#given
    mockPlatform(realPlatform === "linux" ? "win32" : "linux")
    //#when
    restorePlatform()
    //#then
    expect(process.platform).toBe(realPlatform)
  })
})

describe("mockCapabilities", () => {
  it("#given partial caps #when read #then unspecified fields are unavailable", () => {
    //#when
    mockCapabilities({ python: "py" })
    //#then
    expect(getCapabilities()).toMatchObject({ python: "py", hasTar: false, git: null })
  })
})

describe("temp fs helpers", () => {
  it("#given createTempDir #when used #then lives under os.tmpdir and is cleaned up", () => {
    //#given
    const dir = createTempDir()
    const file = createTempFile(dir, "a.txt", "hello")
    //#then
    expect(dir.startsWith(tmpdir())).toBe(true)
    expect(readFileSync(file, "utf-8")).toBe("hello")
    //#when
    cleanupTempDir(dir)
    //#then
    expect(existsSync(dir)).toBe(false)
  })
})
