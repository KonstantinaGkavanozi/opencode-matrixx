import { isAbsolute, relative } from "node:path"
import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool"
import type { TerminalService } from "../../features/terminal-session/service"
import type { TerminalPresentation } from "../../features/terminal-viewer/presentation"
import { TERMINAL_DESCRIPTION } from "./constants"

export function createTerminalTool(service: TerminalService, presentation: TerminalPresentation): ToolDefinition {
  return tool({
    description: TERMINAL_DESCRIPTION,
    args: {
      operation: tool.schema.enum(["create", "list", "write", "read", "snapshot", "resize", "interrupt", "close", "viewer"]),
      id: tool.schema.string().optional(), executable: tool.schema.string().optional(),
      args: tool.schema.array(tool.schema.string()).optional(), cwd: tool.schema.string().optional(),
      env: tool.schema.record(tool.schema.string(), tool.schema.string()).optional(),
      title: tool.schema.string().max(120).optional(), data: tool.schema.string().max(65536).optional(),
      cursor: tool.schema.number().int().nonnegative().optional(),
      cols: tool.schema.number().int().min(2).max(300).optional(), rows: tool.schema.number().int().min(2).max(150).optional(),
    },
    async execute(args, context) {
      const owner = context.sessionID
      const id = args.id ?? ""
      if (context.abort.aborted) throw new Error("Terminal request cancelled")
      if (!["list", "read", "snapshot", "create", "viewer"].includes(args.operation)) service.info(owner, id)
      if (["create", "write", "interrupt", "viewer"].includes(args.operation)) {
        if (typeof context.ask !== "function") throw new Error("Host execution permissions are required for terminal control")
        const command = args.operation === "create" ? [args.executable, ...(args.args ?? [])].join(" ") : args.data ?? args.operation
        await context.ask({ permission: "bash", patterns: [command, "*"], always: [], metadata: { operation: args.operation, command, terminal: id } })
        await context.ask({ permission: "terminal", patterns: [args.operation], always: [], metadata: { operation: args.operation, interactive: true } })
      }
      if (args.operation === "create" && args.cwd) {
        const path = relative(service.directory, args.cwd)
        if (path.startsWith("..") || isAbsolute(path)) await context.ask({ permission: "external_directory", patterns: [args.cwd], always: [], metadata: { cwd: args.cwd } })
      }
      if (context.abort.aborted) throw new Error("Terminal request cancelled")
      switch (args.operation) {
        case "create": {
          if (!args.executable) throw new Error("executable is required")
          return JSON.stringify(await service.create(owner, { ...args, executable: args.executable }))
        }
        case "list": return JSON.stringify(service.list(owner))
        case "write": service.write(owner, id, args.data ?? ""); break
        case "read": return JSON.stringify(service.read(owner, id, args.cursor))
        case "snapshot": return JSON.stringify(await service.snapshot(owner, id))
        case "resize": service.resize(owner, id, args.cols ?? 80, args.rows ?? 24); break
        case "interrupt": service.interrupt(owner, id); break
        case "close": await service.close(owner, id); break
        case "viewer": return JSON.stringify({ url: await presentation.open(owner), message: "Open this private URL in your browser. Closing a pane only closes its attachment, not the agent." })
      }
      return JSON.stringify(service.info(owner, id))
    },
  })
}
