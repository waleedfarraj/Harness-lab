import type { RankableJob } from "./rankingContract";

/**
 * Orders evaluated jobs for the candidate, best match first.
 *
 * TODO(applypilot-rank-001): stub. Returns the jobs in their given order and implements none of the
 * ordering rules. See rankingContract.ts for the exact rules.
 */
export function rankJobs(jobs: readonly RankableJob[]): RankableJob[] {
  return [...jobs];
}
