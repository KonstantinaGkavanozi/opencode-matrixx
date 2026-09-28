// Bridge between command-translator and shell-env.ts for shell-aware operations.

import { detectShellType } from "../shell-env";

/** Current shell kind, resolved via shell-env.ts conventions. */
export function getShellKind(): "unix" | "powershell" | "cmd" {
  return detectShellType();
}
