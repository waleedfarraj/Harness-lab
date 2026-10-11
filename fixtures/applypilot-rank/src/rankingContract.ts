/**
 * Job ranking contract.
 *
 * Derived from ApplyPilot-AI's ranked-jobs ordering (services/job-dashboard/ranking.ts, `compareRank`),
 * reduced to the fields below. Every job here has already been evaluated by ApplyPilot's deterministic
 * job-evaluation engine (or is still pending evaluation); ranking only orders those results.
 *
 * rankJobs returns a NEW array (never mutates its input), best candidate-role match first, ordered by:
 *  1. evaluated jobs before pending jobs (a pending job has no score and is never treated as a low score).
 *  2. recommendation tier: APPLY, then STRETCH, then SKIP.
 *  3. eligibility tier: "eligible" and "not_stated" first, then "unconfirmed", then "not_eligible".
 *  4. higher score first.
 *  5. fewer major gaps first.
 *  6. id ascending, so equal jobs never swap between calls.
 *  Pending jobs are ordered among themselves by id ascending.
 *
 * IMPORTANT: eligibility (step 3) outranks score (step 4). A job the candidate is not eligible for (e.g. a
 * work-authorization blocker) must never rank above an eligible job in the same recommendation tier, however
 * high its score. Unknown eligibility ("unconfirmed") sits between confirmed and blocked: it is neither
 * treated as eligible nor as blocked. Applying to a role the candidate cannot legally take wastes the
 * candidate's time, which is why score alone must not decide.
 */
export type Recommendation = "APPLY" | "STRETCH" | "SKIP";
export type Eligibility = "eligible" | "not_stated" | "unconfirmed" | "not_eligible";

interface JobBase {
  id: string;
  title: string;
}

/** Already scored by ApplyPilot's evaluation engine. */
export interface EvaluatedJob extends JobBase {
  status: "evaluated";
  recommendation: Recommendation;
  score: number;
  eligibility: Eligibility;
  majorGapCount: number;
}

/** Not evaluated yet: it has no score, recommendation or eligibility. */
export interface PendingJob extends JobBase {
  status: "pending";
}

export type RankableJob = EvaluatedJob | PendingJob;
