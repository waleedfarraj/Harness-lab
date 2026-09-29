import "server-only";

import type { AgentTrajectory } from "../agent/types";

const DEDUP_MARKER = /^\(unchanged since your last read of/;
const COMPACTED_MARKER = /^\[compacted .+ result for .+: \d+ chars omitted\]$/;

/**
 * Detects mechanisms that are NOT a changed harness dimension (they never
 * appear in `diffManifests`' output — that's enforced by construction, not
 * by this function) but that the recorded trajectory shows participating in
 * a failure. E.g. read-file deduplication is identical between baseline and
 * candidate, yet it can still be part of *how* a regression manifests once
 * context compaction is also active. This is evidence for the mechanism
 * EXPLANATION layer only — it never feeds into `diagnosis.factors`.
 */
export function detectFixedMechanisms(trajectory: AgentTrajectory): string[] {
  const mechanisms = new Set<string>();
  let dedupHits = 0;
  let compactionHits = 0;

  for (const turn of trajectory.turns) {
    for (const call of turn.toolCalls) {
      if (DEDUP_MARKER.test(call.resultSummary)) dedupHits += 1;
      if (COMPACTED_MARKER.test(call.resultSummary)) compactionHits += 1;
    }
    if (turn.request.newCompactionEvents.length > 0) compactionHits += turn.request.newCompactionEvents.length;
  }

  if (dedupHits > 0) {
    mechanisms.add(`read-file deduplication returned an "unchanged" marker instead of file content ${dedupHits} time(s)`);
  }
  if (compactionHits > 0) {
    mechanisms.add(`context compaction replaced earlier tool results with bounded summaries ${compactionHits} time(s)`);
  }
  if (trajectory.stopReason === "max_turns" && trajectory.turns.every((t) => t.toolCalls.every((c) => c.name !== "write_file"))) {
    mechanisms.add("the agent exhausted its turn budget without ever calling write_file");
  }

  return [...mechanisms];
}
