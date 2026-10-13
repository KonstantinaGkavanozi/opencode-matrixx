/**
 * Emits the viewer assets into `dist/`, which is where `import.meta.dir` resolves
 * once `build:plugin` has flattened the bundle, and where `assets.ts` looks.
 * xterm is bundled rather than externalised: the page serves the script under a
 * `script-src 'self'` CSP with no import map, so bare specifiers cannot resolve.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

const ENTRY = "src/features/terminal-viewer/terminal.ts"
const OUT_DIR = "dist"
const CSS_SOURCE = "node_modules/@xterm/xterm/css/xterm.css"

if (!existsSync(CSS_SOURCE)) throw new Error(`Missing ${CSS_SOURCE}. Run bun install first.`)

mkdirSync(OUT_DIR, { recursive: true })

const result = await Bun.build({
  entrypoints: [ENTRY],
  outdir: OUT_DIR,
  target: "browser",
  format: "esm",
  naming: { entry: "terminal.js" },
})
if (!result.success) throw new AggregateError(result.logs, "Terminal viewer bundle failed")

copyFileSync(CSS_SOURCE, resolve(OUT_DIR, "terminal.css"))

for (const output of result.outputs) {
  console.log(`  ${output.path.replace(`${process.cwd()}\\`, "").replace(`${process.cwd()}/`, "")}`)
}
console.log(`  ${resolve(OUT_DIR, "terminal.css")}`)
