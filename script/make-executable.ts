/**
 * `chmod +x` for a built artifact.
 *
 * Windows has no POSIX execute bit and ships no `chmod`, so the bare
 * `chmod +x` in the build script aborted the whole build there. This no-ops on
 * win32 and reproduces the original POSIX behavior everywhere else.
 */
const target = process.argv[2] ?? "dist/cli.js"

if (process.platform === "win32") {
  process.exit(0)
}

const proc = Bun.spawn(["chmod", "+x", target], { stdout: "inherit", stderr: "inherit" })
process.exit(await proc.exited)