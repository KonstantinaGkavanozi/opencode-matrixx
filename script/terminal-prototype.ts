// Compatibility gate: exercise the runtime's built-in PTY before adding native dependencies.
const decoder = new TextDecoder()
let output = ""
const proc = Bun.spawn([process.execPath, "-e", "console.log('TTY=' + process.stdout.isTTY); console.log('SIZE=' + process.stdout.columns); process.exit(7)"], {
  terminal: { cols: 91, rows: 25, data(_terminal, bytes) { output += decoder.decode(bytes, { stream: true }) } },
})
const timer = setTimeout(() => proc.kill(), 10000)
try {
  const code = await proc.exited
  console.log(JSON.stringify({ bun: Bun.version, platform: process.platform, code, output }))
  if (code !== 7 || !output.includes("TTY=true") || !output.includes("SIZE=91")) process.exitCode = 1
} finally {
  clearTimeout(timer)
  proc.terminal?.close()
}
