/**
 * The Nemotron connectivity test (page + API route) spends Token Factory credits on behalf of whoever
 * calls it, so it is OFF unless explicitly enabled. A public replay deployment never sets this.
 */
export function devRoutesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.HARNESSLAB_ENABLE_DEV_ROUTES === "1";
}
