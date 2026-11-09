import { config as configureZod } from "zod";

/**
 * Zod probes `new Function("")` to decide whether it can JIT-compile validators.
 * The throw is caught, but strict CSPs still report it as a blocked `eval`
 * violation (observed as `/assets/schemas-*.js` on production). Zod explicitly
 * skips the probe when `jitless` is set.
 *
 * Only the browser needs this: Node has no CSP, and keeping JIT on the server
 * preserves validation speed. Call once, before any schema is used.
 */
export function configureCspSafeZod(isBrowser: boolean): void {
  if (isBrowser) configureZod({ jitless: true });
}
