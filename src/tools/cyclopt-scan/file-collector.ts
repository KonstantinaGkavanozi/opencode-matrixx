import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import {
  GENERATED_FRAGMENTS,
  MANIFEST_BASENAMES,
  SECRET_BASENAME_PREFIXES,
  SECRET_BASENAMES,
  SECRET_EXTENSIONS,
  SKIP_DIRS,
  SOURCE_EXTENSIONS,
  WALK_MAX_DEPTH,
  WALK_MAX_ENTRIES,
} from "./constants"
import type { CollectedFiles, ScanScope, SendFile } from "./types"

export type CollectOptions = {
  directory: string
  scope: ScanScope
  paths?: string[]
  maxFiles: number
  maxFileBytes: number
  extraExcludes?: string[]
  /** Injectable for tests; returns stdout or null when git fails. */
  runGit?: (args: string[], cwd: string) => string | null
}

const toPosix = (p: string) => p.split(sep).join("/")

function defaultRunGit(args: string[], cwd: string): string | null {
  try {
    const res = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
    return res.exitCode === 0 ? res.stdout.toString() : null
  } catch {
    return null
  }
}

/** Reason a repo-relative path must never be sent, or undefined if it may be. */
export function exclusionReason(relPath: string, extraExcludes: string[] = []): string | undefined {
  const posix = relPath.split("\\").join("/")
  const parts = posix.split("/")
  const name = parts[parts.length - 1] ?? ""
  const lowerName = name.toLowerCase()
  if (parts.slice(0, -1).some((seg) => SKIP_DIRS.includes(seg))) return "excluded directory"
  if (SECRET_BASENAME_PREFIXES.some((p) => lowerName.startsWith(p))) return "secret guard"
  if (SECRET_BASENAMES.includes(lowerName)) return "secret guard"
  if (SECRET_EXTENSIONS.includes(extname(lowerName))) return "secret guard"
  if (extraExcludes.some((frag) => frag && posix.includes(frag))) return "user exclude"
  return undefined
}

function isBinary(buf: Buffer): boolean {
  const end = Math.min(buf.length, 8000)
  for (let i = 0; i < end; i++) if (buf[i] === 0) return true
  return false
}

function classify(relPath: string): "source" | "manifest" | undefined {
  const name = basename(relPath)
  if (MANIFEST_BASENAMES.includes(name)) return "manifest"
  const lower = name.toLowerCase()
  if (GENERATED_FRAGMENTS.some((f) => lower.includes(f))) return undefined
  return SOURCE_EXTENSIONS.includes(extname(lower)) ? "source" : undefined
}

function walk(root: string, start: string): string[] {
  const out: string[] = []
  let visited = 0
  const stack: { dir: string; depth: number }[] = [{ dir: start, depth: 0 }]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || cur.depth > WALK_MAX_DEPTH) continue
    let entries: import("node:fs").Dirent[]
    try {
      entries = readdirSync(cur.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (++visited > WALK_MAX_ENTRIES) return out
      // Symlinks are neither files nor directories here, so they are never followed.
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.includes(entry.name)) stack.push({ dir: join(cur.dir, entry.name), depth: cur.depth + 1 })
      } else if (entry.isFile()) {
        out.push(toPosix(relative(root, join(cur.dir, entry.name))))
      }
    }
  }
  return out
}

function gitLines(out: string | null): string[] {
  return (out ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

function resolveCandidates(opts: CollectOptions, root: string): string[] {
  const git = opts.runGit ?? defaultRunGit
  if (opts.scope === "repo") return walk(root, root)
  if (opts.scope === "staged") return gitLines(git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"], root))
  if (opts.scope === "changed") {
    const base = git(["merge-base", "HEAD", "origin/HEAD"], root)?.trim() || git(["merge-base", "HEAD", "origin/dev"], root)?.trim()
    const diff = gitLines(git(["diff", "--name-only", "--diff-filter=ACMR", base || "HEAD"], root))
    const untracked = gitLines(git(["ls-files", "--others", "--exclude-standard"], root))
    return [...new Set([...diff, ...untracked])]
  }
  // scope === "paths": expand files and directories, refusing anything outside the root.
  const rootReal = realpathSync(root)
  const out: string[] = []
  for (const raw of opts.paths ?? []) {
    const abs = resolve(root, raw)
    let real: string
    try {
      real = realpathSync(abs)
    } catch {
      continue
    }
    const rel = relative(rootReal, real)
    if (rel.startsWith("..") || isAbsolute(rel)) continue
    const stat = lstatSync(abs)
    if (stat.isDirectory()) out.push(...walk(rootReal, real))
    else if (stat.isFile()) out.push(toPosix(rel))
  }
  return out
}

/** Gather the files a scan may send, split into source and manifest channels. */
export function collectFiles(opts: CollectOptions): CollectedFiles {
  const root = resolve(opts.directory)
  const result: CollectedFiles = { source: [], manifests: [], skipped: [], totalBytes: 0 }
  const candidates = [...new Set(resolveCandidates(opts, root))].sort()

  for (const rel of candidates) {
    const excluded = exclusionReason(rel, opts.extraExcludes)
    if (excluded) {
      result.skipped.push({ path: rel, reason: excluded })
      continue
    }
    const kind = classify(rel)
    if (!kind) continue
    if (result.source.length + result.manifests.length >= opts.maxFiles) {
      result.skipped.push({ path: rel, reason: `over max_files (${opts.maxFiles})` })
      continue
    }
    let buf: Buffer
    try {
      buf = readFileSync(join(root, rel))
    } catch {
      result.skipped.push({ path: rel, reason: "unreadable" })
      continue
    }
    if (buf.length > opts.maxFileBytes) {
      result.skipped.push({ path: rel, reason: `over max_file_bytes (${buf.length})` })
      continue
    }
    if (isBinary(buf)) {
      result.skipped.push({ path: rel, reason: "binary" })
      continue
    }
    const file: SendFile = { filename: rel, content: buf.toString("utf8") }
    result.totalBytes += buf.length
    ;(kind === "manifest" ? result.manifests : result.source).push(file)
  }
  return result
}
