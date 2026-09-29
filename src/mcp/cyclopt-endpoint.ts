import type { CycloptConfig } from "../config/schema"

const CYCLOPT_TOKEN_ENV = "CYCLOPT_API_TOKEN"
export const CYCLOPT_DEFAULT_BASE_URL = "https://mcp-server.cyclopt.com/mcp"

export type CycloptEndpoint = { baseUrl: string; token: string }

export type CycloptResolution = { ok: true; endpoint: CycloptEndpoint } | { ok: false; error: string }

export type CycloptCredentialConfig = Partial<Pick<CycloptConfig, "base_url" | "api_token">>

/** Token precedence: CYCLOPT_API_TOKEN env var, then `cyclopt.api_token` from the user-level config. */
function pickToken(config?: CycloptCredentialConfig): string | undefined {
  return process.env[CYCLOPT_TOKEN_ENV]?.trim() || config?.api_token?.trim() || undefined
}

/**
 * Single source of truth for the Cyclopt base URL and credential. Both the
 * built-in MCP registration and the native cyclopt_scan tool resolve through
 * here, so auth can only be wrong in one place.
 */
export function resolveCycloptEndpoint(config?: CycloptCredentialConfig): CycloptResolution {
  const token = pickToken(config)
  if (!token) {
    return {
      ok: false,
      error: `No Cyclopt API token found. Set "cyclopt.api_token" in ~/.config/opencode/matrixx.jsonc (applies to every project) or export ${CYCLOPT_TOKEN_ENV}, then restart OpenCode.`,
    }
  }
  return { ok: true, endpoint: { baseUrl: config?.base_url ?? CYCLOPT_DEFAULT_BASE_URL, token } }
}

export function hasCycloptToken(config?: CycloptCredentialConfig): boolean {
  return pickToken(config) !== undefined
}
