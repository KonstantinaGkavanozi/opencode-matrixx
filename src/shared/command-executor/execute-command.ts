import { spawn, which } from "bun"
import { detectShellType, type ShellType } from "../shell-env"

/** Build the argv that runs `command` in the given shell kind. Never goes through a shell string. */
export function buildShellArgv(command: string, shell: ShellType = detectShellType()): string[] {
	switch (shell) {
		case "powershell":
			return [which("pwsh") ? "pwsh" : "powershell", "-NoProfile", "-NonInteractive", "-Command", command]
		case "cmd":
			return ["cmd", "/c", command]
		default:
			return [which("sh") ?? which("bash") ?? "sh", "-c", command]
	}
}

/** Detect whether a command string looks like a shell script (metacharacters) or a direct binary invocation. */
function isShellScript(command: string): boolean {
	return /[;&|<>`$!]/.test(command)
}

/** Parse a command string into [binary, ...args] for direct spawn. */
function parseBinaryArgv(command: string): string[] {
	const parts: string[] = []
	let current = ""
	let inSingleQuote = false
	let inDoubleQuote = false
	let escaped = false

	for (let i = 0; i < command.length; i++) {
		const ch = command[i]

		if (escaped) {
			current += ch
			escaped = false
			continue
		}
		if (ch === "\\") {
			escaped = true
			current += ch
			continue
		}
		if (ch === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote
			continue
		}
		if (ch === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote
			continue
		}
		if (ch === " " || ch === "\t") {
			if (inSingleQuote || inDoubleQuote) {
				current += ch
			} else if (current) {
				parts.push(current)
				current = ""
			}
			continue
		}
		current += ch
	}
	if (current) {
		parts.push(current)
	}
	return parts
}

function formatOutput(stdout: string, stderr: string): string {
	if (!stderr) return stdout
	return stdout ? `${stdout}\n[stderr: ${stderr}]` : `[stderr: ${stderr}]`
}

export async function executeCommand(command: string, timeoutMs = 30000): Promise<string> {
	try {
		const argv = isShellScript(command)
			? buildShellArgv(command)
			: parseBinaryArgv(command)

		const proc = spawn(argv, {
			stdout: "pipe",
			stderr: "pipe",
			timeout: timeoutMs,
		})

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		])

		const out = stdout.trim()
		const err = stderr.trim()

		if (exitCode !== 0 && !err) {
			return formatOutput(out, `Command exited with code ${exitCode}`)
		}
		return formatOutput(out, err)
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error)
		return `[stderr: ${message}]`
	}
}
