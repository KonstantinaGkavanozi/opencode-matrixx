import { describe, expect, it } from "bun:test"
import { rmRf, cpR, mvFile, mkdirp } from "../../../src/shared/command-translator/fs-emulation"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const TEST_ROOT = join(process.cwd(), ".matrixx", "_test-fs-emulation")

function setupTestDir(name: string): string {
  const dir = join(TEST_ROOT, name)
  if (existsSync(dir)) {
    rmRf(dir)
  }
  mkdirSync(dir, { recursive: true })
  return dir
}

function readText(path: string): string {
  return readFileSync(path, "utf-8").toString()
}

describe("rmRf", () => {
  it("should remove an empty directory", () => {
    const dir = setupTestDir("rm-empty")
    mkdirSync(join(dir, "empty-sub"))
    rmRf(join(dir, "empty-sub"))
    expect(existsSync(join(dir, "empty-sub"))).toBe(false)
  })

  it("should remove a non-empty directory recursively", () => {
    const dir = setupTestDir("rm-recursive")
    mkdirSync(join(dir, "sub"), { recursive: true })
    writeFileSync(join(dir, "sub", "file.txt"), "hello")
    writeFileSync(join(dir, "top.txt"), "world")
    rmRf(dir)
    expect(existsSync(dir)).toBe(false)
  })

  it("should not throw when the path does not exist", () => {
    expect(() => rmRf("/nonexistent-path-that-definitely-does-not-exist-abc123")).not.toThrow()
  })
})

describe("cpR", () => {
  it("should copy a file", () => {
    const src = setupTestDir("cp-file-src")
    const dst = setupTestDir("cp-file-dst")
    writeFileSync(join(src, "source.txt"), "copy me")
    cpR(join(src, "source.txt"), join(dst, "dest.txt"))
    expect(readText(join(dst, "dest.txt"))).toBe("copy me")
  })

  it("should copy a directory recursively", () => {
    const src = setupTestDir("cp-dir-src")
    const dst = setupTestDir("cp-dir-dst")
    mkdirSync(join(src, "nested", "deep"), { recursive: true })
    writeFileSync(join(src, "nested", "a.txt"), "aaa")
    writeFileSync(join(src, "nested", "deep", "b.txt"), "bbb")
    cpR(join(src, "nested"), join(dst, "copied"))
    expect(readText(join(dst, "copied", "a.txt"))).toBe("aaa")
    expect(readText(join(dst, "copied", "deep", "b.txt"))).toBe("bbb")
  })

  it("should handle relative paths", () => {
    const dir = setupTestDir("cp-relative")
    writeFileSync(join(dir, "from.txt"), "relative")
    cpR(join(dir, "from.txt"), join(dir, "to.txt"))
    expect(readText(join(dir, "to.txt"))).toBe("relative")
  })
})

describe("mvFile", () => {
  it("should move a file within the same directory", () => {
    const dir = setupTestDir("mv-same-dir")
    writeFileSync(join(dir, "old.txt"), "moved")
    mvFile(join(dir, "old.txt"), join(dir, "new.txt"))
    expect(existsSync(join(dir, "old.txt"))).toBe(false)
    expect(readText(join(dir, "new.txt"))).toBe("moved")
  })

  it("should move a file to a different directory", () => {
    const src = setupTestDir("mv-to-src")
    const dst = setupTestDir("mv-to-dst")
    writeFileSync(join(src, "file.txt"), "cross-move")
    mvFile(join(src, "file.txt"), join(dst, "file.txt"))
    expect(existsSync(join(src, "file.txt"))).toBe(false)
    expect(readText(join(dst, "file.txt"))).toBe("cross-move")
  })

  it("should throw on invalid source", () => {
    expect(() => mvFile("/nonexistent-source", "/dev/null")).toThrow()
  })
})

describe("mkdirp", () => {
  it("should create nested directories", () => {
    const dir = setupTestDir("mkdirp-nested")
    const target = join(dir, "a", "b", "c")
    mkdirp(target)
    expect(existsSync(target)).toBe(true)
  })

  it("should not throw if directory already exists", () => {
    const dir = setupTestDir("mkdirp-existing")
    mkdirp(dir)
    expect(() => mkdirp(dir)).not.toThrow()
  })

  it("should create deeply nested structure", () => {
    const base = setupTestDir("mkdirp-deep")
    mkdirp(join(base, "1", "2", "3", "4", "5"))
    expect(existsSync(join(base, "1", "2", "3", "4", "5"))).toBe(true)
  })
})
