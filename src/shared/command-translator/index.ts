// Barrel exports for command-translator.

export { getCapabilities, resetCapabilitiesForTesting as resetCapabilities } from "./capabilities";
export { getPlatform, getWindowsBuildNumber, hasTarOnWindows } from "./platform";
export { resolve } from "./registry";
export { resetCapabilitiesForTesting, runTranslated } from "./runner";
export { getShellKind } from "./shell-integration";
export type {
  Capabilities,
  Platform,
  RunOptions,
  ShellKind,
  StrategyKind,
  TranslatedCommand,
} from "./types";
export {
  CommandFailedError,
  MissingBinaryError,
  TranslationFailedError,
  UnsupportedCommandError,
} from "./types";
