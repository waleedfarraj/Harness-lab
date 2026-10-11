/**
 * The Nemotron connectivity test (page + API route) spends Token Factory credits on behalf of whoever
 * calls it, so it is OFF unless explicitly enabled. On Vercel it is always off, whatever the env says:
 * the hosted app is a read-only replay of saved evidence.
 */
export function devRoutesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL) return false;
  return env.HARNESSLAB_ENABLE_DEV_ROUTES === "1";
}
