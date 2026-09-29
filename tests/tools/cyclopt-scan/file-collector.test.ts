import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { collectFiles, exclusionReason } from "../../../src/tools/cyclopt-scan/file-collector"

let root: string

function put(rel: string, content: string | Buffer = "x = 1\n"): void {
  const abs = join(root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

const base = { maxFiles: 200, maxFileBytes: 10_000 }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cyclopt-collect-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("exclusionReason (secret guard)", () => {
  test("blocks secret-bearing files regardless of location", () => {
    //#given
    const secrets = [".env", ".env.local", "config/.env.production", "certs/server.pem", "k/id_rsa", "k/id_rsa.pub", "a/private.key", "store.p12", ".npmrc", "x/credentials.json"]
    //#then
    for (const p of secrets) expect(exclusionReason(p)).toBe("secret guard")
  })

  test("blocks excluded directories at any depth", () => {
    //#then
    expect(exclusionReason("node_modules/x/index.js")).toBe("excluded directory")
    expect(exclusionReason("pkg/dist/out.js")).toBe("excluded directory")
    expect(exclusionReason(".matrixx/tasks/T-1.json")).toBe("excluded directory")
    expect(exclusionReason(".git/config")).toBe("excluded directory")
  })

  test("honours user excludes", () => {
    //#then
    expect(exclusionReason("src/legacy/a.ts", ["legacy/"])).toBe("user exclude")
    expect(exclusionReason("src/new/a.ts", ["legacy/"])).toBeUndefined()
  })

  test("allows ordinary source", () => {
    //#then
    expect(exclusionReason("src/environment.ts")).toBeUndefined()
  })
})

describe("collectFiles", () => {
  test("splits source and manifest channels and sorts by path", () => {
    //#given
    put("src/b.ts")
    put("src/a.py")
    put("package.json", "{}")
    put("README.md", "# hi")
    //#when
    const out = collectFiles({ ...base, directory: root, scope: "repo" })
    //#then
    expect(out.source.map((f) => f.filename)).toEqual(["src/a.py", "src/b.ts"])
    expect(out.manifests.map((f) => f.filename)).toEqual(["package.json"])
  })

  test("never collects secrets or vendored dirs, and reports them as skipped", () => {
    //#given
    put(".env", "SECRET=1")
    put("src/app.ts")
    put("node_modules/dep/index.js")
    put("keys/server.pem", "FAKE-KEY-MATERIAL")
    //#when
    const out = collectFiles({ ...base, directory: root, scope: "repo" })
    //#then
    expect(out.source.map((f) => f.filename)).toEqual(["src/app.ts"])
    expect(out.skipped.some((s) => s.path === ".env" && s.reason === "secret guard")).toBe(true)
  })

  test("skips oversize and binary files with reasons", () => {
    //#given
    put("big.ts", "a".repeat(20_000))
    put("bin.ts", Buffer.from([0x61, 0x00, 0x62]))
    put("ok.ts")
    //#when
    const out = collectFiles({ ...base, directory: root, scope: "repo" })
    //#then
    expect(out.source.map((f) => f.filename)).toEqual(["ok.ts"])
    expect(out.skipped.map((s) => s.reason).some((r) => r.startsWith("over max_file_bytes"))).toBe(true)
    expect(out.skipped.some((s) => s.reason === "binary")).toBe(true)
  })

  test("enforces max_files and lists the overflow", () => {
    //#given
    for (const n of ["a", "b", "c"]) put(`${n}.ts`)
    //#when
    const out = collectFiles({ ...base, directory: root, scope: "repo", maxFiles: 2 })
    //#then
    expect(out.source).toHaveLength(2)
    expect(out.skipped.some((s) => s.reason.startsWith("over max_files"))).toBe(true)
  })

  test("tracks total bytes of what will be sent", () => {
    //#given
    put("a.ts", "12345")
    put("b.ts", "123")
    //#when
    const out = collectFiles({ ...base, directory: root, scope: "repo" })
    //#then
    expect(out.totalBytes).toBe(8)
  })

  test("scope=paths expands directories and files", () => {
    //#given
    put("src/a.ts")
    put("src/deep/b.ts")
    put("other/c.ts")
    //#when
    const out = collectFiles({ ...base, directory: root, scope: "paths", paths: ["src", "other/c.ts"] })
    //#then
    expect(out.source.map((f) => f.filename)).toEqual(["other/c.ts", "src/a.ts", "src/deep/b.ts"])
  })

  test("scope=paths refuses traversal outside the project root", () => {
    //#given a file that exists outside the root
    const outside = mkdtempSync(join(tmpdir(), "cyclopt-outside-"))
    writeFileSync(join(outside, "secret.ts"), "x")
    put("in.ts")
    //#when
    const out = collectFiles({ ...base, directory: root, scope: "paths", paths: [join(outside, "secret.ts"), "../../etc/passwd", "in.ts"] })
    rmSync(outside, { recursive: true, force: true })
    //#then only the in-root file is collected
    expect(out.source.map((f) => f.filename)).toEqual(["in.ts"])
  })

  test("does not follow symlinks", () => {
    //#given a symlinked directory pointing outside the root
    const outside = mkdtempSync(join(tmpdir(), "cyclopt-link-"))
    writeFileSync(join(outside, "leak.ts"), "x")
    try {
      symlinkSync(outside, join(root, "linked"), "junction")
    } catch {
      rmSync(outside, { recursive: true, force: true })
      return // symlinks unavailable on this platform/user; nothing to assert
    }
    put("real.ts")
    //#when
    const out = collectFiles({ ...base, directory: root, scope: "repo" })
    rmSync(outside, { recursive: true, force: true })
    //#then
    expect(out.source.map((f) => f.filename)).toEqual(["real.ts"])
  })

  test("scope=changed unions git diff with untracked and drops excluded files", () => {
    //#given
    put("src/a.ts")
    put("src/new.ts")
    put(".env", "S=1")
    const calls: string[][] = []
    const runGit = (args: string[]) => {
      calls.push(args)
      if (args[0] === "merge-base") return "abc123\n"
      if (args[0] === "diff") return "src/a.ts\n.env\n"
      if (args[0] === "ls-files") return "src/new.ts\n"
      return null
    }
    //#when
    const out = collectFiles({ ...base, directory: root, scope: "changed", runGit })
    //#then
    expect(out.source.map((f) => f.filename)).toEqual(["src/a.ts", "src/new.ts"])
    expect(calls.some((c) => c[0] === "diff" && c.includes("abc123"))).toBe(true)
  })

  test("scope=changed falls back to HEAD when no merge-base exists", () => {
    //#given
    put("a.ts")
    const calls: string[][] = []
    const runGit = (args: string[]) => {
      calls.push(args)
      return args[0] === "diff" ? "a.ts\n" : null
    }
    //#when
    const out = collectFiles({ ...base, directory: root, scope: "changed", runGit })
    //#then
    expect(out.source).toHaveLength(1)
    expect(calls.find((c) => c[0] === "diff")).toContain("HEAD")
  })

  test("scope=staged uses the cached diff", () => {
    //#given
    put("s.ts")
    const runGit = (args: string[]) => (args.includes("--cached") ? "s.ts\n" : null)
    //#when
    const out = collectFiles({ ...base, directory: root, scope: "staged", runGit })
    //#then
    expect(out.source.map((f) => f.filename)).toEqual(["s.ts"])
  })
})
