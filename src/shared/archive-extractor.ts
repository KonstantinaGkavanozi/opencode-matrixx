// Single source of truth for zip extraction across platforms.
// Used by zip-extractor.ts (public extractZip API) and the command-translator `unzip` entry.

import { mkdirSync } from "node:fs"
import { spawn } from "bun"
import { getCapabilities } from "./command-translator/capabilities"
import { getPlatform, getWindowsSystemTar } from "./command-translator/platform"
import type { Capabilities, Platform } from "./command-translator/types"

export interface ArchiveArgv {
  argv: string[]
  resolvedWith: string
}

export interface ExtractOptions {
  platform?: Platform
  capabilities?: Capabilities
}

/** Parse `unzip [-o] <archive> [-d <dest>]`. */
export function parseUnzipArgs(argv: string[]): { archive: string; dest: string } {
  const args = argv.slice(1)
  const dIdx = args.indexOf("-d")
  const dest = dIdx >= 0 ? (args[dIdx + 1] ?? ".") : "."
  const archive = args.find((a, i) => !a.startsWith("-") && (dIdx < 0 || i !== dIdx + 1)) ?? ""
  return { archive, dest }
}

function escapePowerShellPath(path: string): string {
  return path.replace(/'/g, "''")
}

function buildExpandArchive(archive: string, dest: string): string {
  return `Expand-Archive -Path '${escapePowerShellPath(archive)}' -DestinationPath '${escapePowerShellPath(dest)}' -Force`
}

/**
 * Build the argv that extracts `archive` into `dest` on the given platform.
 * Returns null when no extraction tool is available (Windows without tar/pwsh/powershell).
 */
export function buildExtractArgv(
  archive: string,
  dest: string,
  platform: Platform,
  caps: Capabilities,
): ArchiveArgv | null {
  if (platform !== "win32") {
    return { argv: ["unzip", "-o", archive, "-d", dest], resolvedWith: "unzip" }
  }
  if (caps.hasTar) {
    const build = caps.winBuild ? `(build ${caps.winBuild})` : ""
    return { argv: [getWindowsSystemTar() ?? "tar", "-xf", archive, "-C", dest], resolvedWith: `tar${build}` }
  }
  if (caps.hasPwsh) {
    return { argv: ["pwsh", "-Command", buildExpandArchive(archive, dest)], resolvedWith: "pwsh" }
  }
  if (caps.hasPowerShell) {
    return { argv: ["powershell", "-Command", buildExpandArchive(archive, dest)], resolvedWith: "powershell" }
  }
  return null
}

/** Extract a zip archive into destDir using the best tool available on this platform. */
export async function extractArchive(
  archivePath: string,
  destDir: string,
  options?: ExtractOptions,
): Promise<void> {
  const platform = options?.platform ?? getPlatform()
  const caps = options?.capabilities ?? getCapabilities()
  const resolved = buildExtractArgv(archivePath, destDir, platform, caps)

  if (!resolved) {
    throw new Error(
      "zip extraction failed: no extraction tool found (need tar, pwsh, or powershell on Windows)",
    )
  }

  // tar (unlike unzip -d) does not create the destination directory.
  mkdirSync(destDir, { recursive: true })

  const proc = spawn(resolved.argv, { stdout: "ignore", stderr: "pipe" })
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array<ArrayBuffer>>).text()
    throw new Error(`zip extraction failed (exit ${exitCode}): ${stderr}`)
  }
}
