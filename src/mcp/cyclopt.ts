import { type CycloptCredentialConfig, resolveCycloptEndpoint } from "./cyclopt-endpoint"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

export function createCycloptConfig(config?: CycloptCredentialConfig): RemoteMcpConfig {
  const resolution = resolveCycloptEndpoint(config)
  if (!resolution.ok) throw new Error(resolution.error)
  return {
    type: "remote" as const,
    url: resolution.endpoint.baseUrl,
    enabled: true,
    headers: { Authorization: `Bearer ${resolution.endpoint.token}` },
    oauth: false as const,
  }
}
