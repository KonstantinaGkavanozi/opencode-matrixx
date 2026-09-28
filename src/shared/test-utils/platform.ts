// Cross-platform test helpers. Test-only: never import from production code.
//
//   beforeEach(() => mockPlatform("win32"))
//   afterEach(() => { restorePlatform(); restoreCapabilities() })

import { resetCapabilitiesForTesting, setCapabilitiesForTesting } from "../command-translator/capabilities"
import type { Capabilities, Platform } from "../command-translator/types"

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")

export const NO_CAPABILITIES: Capabilities = {
  winBuild: null,
  hasTar: false,
  hasPwsh: false,
  hasPowerShell: false,
  python: null,
  git: null,
}

/** Make `process.platform` report the given platform until restorePlatform() is called. */
export function mockPlatform(platform: Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
}

export function restorePlatform(): void {
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform)
}

/** Replace the cached capability probe result. Unspecified fields default to "not available". */
export function mockCapabilities(caps: Partial<Capabilities>): Capabilities {
  const full = { ...NO_CAPABILITIES, ...caps }
  setCapabilitiesForTesting(full)
  return full
}

export function restoreCapabilities(): void {
  resetCapabilitiesForTesting()
}
