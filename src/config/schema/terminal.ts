import { z } from "zod"

export const TerminalConfigSchema = z.object({
  enabled: z.boolean().default(false),
  backend: z.enum(["auto", "conpty", "pty"]).default("auto"),
  max_sessions: z.number().int().min(1).max(32).default(8),
  output_buffer_bytes: z.number().int().min(4096).max(4 * 1024 * 1024).default(262144),
  idle_timeout_ms: z.number().int().min(1000).max(86400000).default(1800000),
  viewer: z.boolean().default(false),
})
export type TerminalConfig = z.infer<typeof TerminalConfigSchema>
