import { isAbsolute, relative } from "node:path"
import { z } from "zod"
import type { TerminalService } from "../../features/terminal-session/service"
import type { TerminalPresentation } from "../../features/terminal-viewer/presentation"
import type { V2ToolContext, V2ToolDefinition } from "../../plugin/types"
import { TERMINAL_DESCRIPTION } from "./constants"

type TerminalAskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: Record<string, unknown>
}

/**
 * V1 exposes `context.ask` for an interactive permission prompt; V2 has no
 * equivalent on the tool context and instead gates execution through the host
 * permission system (declared below via `options.permission`, evaluated against
 * the agent's `permissions[]`). When running under the V1 bridge the real
 * `ask` is present and is still consulted; on native V2 it is absent and the
 * host decision stands.
 */
function askFn(context: V2ToolContext): ((input: TerminalAskInput) => Promise<void>) | undefined {
  const ask = (context as { ask?: unknown }).ask
  return typeof ask === "function" ? (ask as (input: TerminalAskInput) => Promise<void>) : undefined
}

export function createTerminalTool(service: TerminalService, presentation: TerminalPresentation): V2ToolDefinition {
  return {
    name: "terminal",
    description: TERMINAL_DESCRIPTION,
    input: z.object({
      operation: z.enum(["create", "list", "write", "read", "snapshot", "resize", "interrupt", "close", "viewer"]),
      id: z.string().optional(),
      executable: z.string().optional(),
      args: z.array(z.string()).optional(),
      cwd: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
      title: z.string().max(120).optional(),
      data: z.string().max(65536).optional(),
      cursor: z.number().int().nonnegative().optional(),
      cols: z.number().int().min(2).max(300).optional(),
      rows: z.number().int().min(2).max(150).optional(),
    }),
    options: { permission: "terminal" },
    async execute(args, context) {
      const owner = context.sessionID
      const ask = askFn(context)
      const id = (args.id as string | undefined) ?? ""
      if (context.signal.aborted) throw new Error("Terminal request cancelled")
      if (!["list", "read", "snapshot", "create", "viewer"].includes(args.operation as string)) {
        service.info(owner, id)
      }
      if (["create", "write", "interrupt", "viewer"].includes(args.operation as string) && ask) {
        const command =
          args.operation === "create"
            ? [(args.executable as string | undefined), ...((args.args as string[] | undefined) ?? [])].join(" ")
            : ((args.data as string | undefined) ?? (args.operation as string))
        await ask({ permission: "bash", patterns: [command, "*"], always: [], metadata: { operation: args.operation, command, terminal: id } })
        await ask({ permission: "terminal", patterns: [args.operation as string], always: [], metadata: { operation: args.operation, interactive: true } })
      }
      const cwd = args.cwd as string | undefined
      if (args.operation === "create" && cwd && ask) {
        const path = relative(service.directory, cwd)
        if (path.startsWith("..") || isAbsolute(path)) {
          await ask({ permission: "external_directory", patterns: [cwd], always: [], metadata: { cwd } })
        }
      }
      if (context.signal.aborted) throw new Error("Terminal request cancelled")
      switch (args.operation as string) {
        case "create": {
          const executable = args.executable as string | undefined
          if (!executable) throw new Error("executable is required")
          return { content: JSON.stringify(await service.create(owner, { ...args, executable })) }
        }
        case "list":
          return { content: JSON.stringify(service.list(owner)) }
        case "write":
          service.write(owner, id, (args.data as string | undefined) ?? "")
          break
        case "read":
          return { content: JSON.stringify(service.read(owner, id, args.cursor as number | undefined)) }
        case "snapshot":
          return { content: JSON.stringify(await service.snapshot(owner, id)) }
        case "resize":
          service.resize(owner, id, (args.cols as number | undefined) ?? 80, (args.rows as number | undefined) ?? 24)
          break
        case "interrupt":
          service.interrupt(owner, id)
          break
        case "close":
          await service.close(owner, id)
          break
        case "viewer":
          return {
            content: JSON.stringify({
              url: await presentation.open(owner),
              message:
                "Open this private URL in your browser. Closing a pane only closes its attachment, not the agent.",
            }),
          }
      }
      return { content: JSON.stringify(service.info(owner, id)) }
    },
  }
}