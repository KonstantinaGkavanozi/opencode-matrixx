// Real (unmocked) smoke test of the command translator on the current OS.
// Usage: bun run script/translator-smoke.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { getCapabilities, getPlatform, runTranslated } from "../src/shared/command-translator"
import { resolve } from "../src/shared/command-translator/registry"
import { cleanupTempDir, createTempDir } from "../src/shared/test-utils/fs"

let failures = 0
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -> ${detail}` : ""}`)
  if (!ok) failures++
}

const caps = getCapabilities()
console.log(`platform=${getPlatform()} capabilities=${JSON.stringify(caps)}\n`)

// 1. What each Unix command gets translated to on this OS.
console.log("--- translation table ---")
const samples: string[][] = [
  ["unzip", "-o", "a.zip", "-d", "out"],
  ["python3", "--version"],
  ["tar", "-xf", "a.tar"],
  ["chmod", "+x", "f"],
  ["rm", "-rf", "x"],
  ["tmux", "ls"],
]
for (const argv of samples) {
  const r = resolve(argv[0], argv)
  console.log(`${argv.join(" ").padEnd(28)} => ${r ? `[${r.strategy}/${r.resolvedWith}] ${r.argv.join(" ")}` : "(no strategy on this platform)"}`)
}

const dir = createTempDir("matrixx-smoke-")
try {
  // 2. Filesystem commands, executed for real.
  console.log("\n--- fs emulation (executed) ---")
  const nested = join(dir, "a", "b")
  await runTranslated(["mkdir", "-p", nested])
  check("mkdir -p", existsSync(nested))
  const file = join(dir, "a", "f.txt")
  writeFileSync(file, "hello")
  await runTranslated(["cp", file, join(nested, "copy.txt")])
  check("cp file", readFileSync(join(nested, "copy.txt"), "utf-8") === "hello")
  await runTranslated(["cp", "-r", join(dir, "a"), join(dir, "a2")])
  check("cp -r dir", existsSync(join(dir, "a2", "b", "copy.txt")))
  await runTranslated(["mv", join(nested, "copy.txt"), join(nested, "moved.txt")])
  check("mv", existsSync(join(nested, "moved.txt")) && !existsSync(join(nested, "copy.txt")))
  await runTranslated(["chmod", "+x", file])
  check("chmod (no-op on Windows)", existsSync(file))
  await runTranslated(["rm", "-rf", join(dir, "a")])
  check("rm -rf", !existsSync(join(dir, "a")))

  // 3. unzip: build a real zip, then extract through every strategy available here.
  console.log("\n--- unzip translation (executed) ---")
  const src = join(dir, "zipsrc")
  mkdirSync(src)
  writeFileSync(join(src, "hello.txt"), "zipped")
  const zip = join(dir, "test.zip")
  const built = Bun.spawnSync(
    process.platform === "win32"
      ? ["powershell", "-NoProfile", "-Command", `Compress-Archive -Path '${join(src, "hello.txt")}' -DestinationPath '${zip}' -Force`]
      : ["zip", "-j", zip, join(src, "hello.txt")],
  )
  if (built.exitCode !== 0) {
    console.log("SKIP  could not create a test zip on this machine")
  } else {
    const variants: Array<[string, Partial<typeof caps>]> = [["default (best available)", {}]]
    if (process.platform === "win32") {
      variants.push(["forced pwsh/powershell (no tar)", { hasTar: false }])
    }
    for (const [label, override] of variants) {
      const out = join(dir, `out-${variants.findIndex((v) => v[0] === label)}`)
      try {
        await runTranslated(["unzip", "-o", zip, "-d", out], { capabilities: { ...caps, ...override } })
        check(`unzip via ${label}`, readFileSync(join(out, "hello.txt"), "utf-8") === "zipped")
      } catch (e) {
        check(`unzip via ${label}`, false, e instanceof Error ? e.message : String(e))
      }
    }
  }

  // 4. python3 -> whatever launcher exists here.
  console.log("\n--- python3 translation (executed) ---")
  const py = resolve("python3", ["python3", "--version"])
  if (!py) {
    console.log("SKIP  no Python found on this machine")
  } else {
    const r = Bun.spawnSync(py.argv)
    const out = `${r.stdout.toString()}${r.stderr.toString()}`.trim()
    check(`python3 --version via ${py.resolvedWith}`, r.exitCode === 0, out)
  }

  // 5. tmux is rejected cleanly on Windows, untouched elsewhere.
  console.log("\n--- tmux ---")
  const tmuxErr = await runTranslated(["tmux", "-V"]).then(() => null, (e: Error) => e)
  if (process.platform === "win32") {
    check("tmux rejected with hint", tmuxErr?.name === "UnsupportedCommandError", tmuxErr?.message)
  } else {
    console.log("INFO  non-Windows: tmux passes through to the real binary")
  }
} finally {
  cleanupTempDir(dir)
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
