import { z } from "zod"

/** Startup-token tool auto-gating — defer rarely-needed LLM tools until auto-detect or opt-in */
export const ToolGatingConfigSchema = z.object({
  /** BDD tools (bdd_create_contract, bdd_parse_gherkin, bdd_pipeline_run, bdd_validate_contract). Undefined = auto: register iff *.feature found under directory. True/false force the outcome. */
  bdd_tools: z.boolean().optional(),
  /** PDF figure extraction tool (pdf_extract_figures). Undefined = auto: register iff *.pdf found under directory. True/false force the outcome. */
  pdf_figures: z.boolean().optional(),
  /** Multimodal look_at tool. Undefined = auto: register iff construct agent is enabled and a media file (png|jpg|jpeg|gif|webp|svg|pdf) is found. True forces registration, false forces skip. */
  look_at: z.boolean().optional(),
  /** Cyclopt scan tools (cyclopt_scan, cyclopt_job_status). Undefined = auto: register iff a Cyclopt token is configured (cyclopt.api_token or CYCLOPT_API_TOKEN). True/false force the outcome. */
  cyclopt_tools: z.boolean().optional(),
  /** Model preset tool (preset). Default false; set true to restore registration. The /preset slashcommand remains the supported path. */
  preset_tools: z.boolean().default(false),
})

export type ToolGatingConfig = z.infer<typeof ToolGatingConfigSchema>
