import "server-only";

import type { HarnessDimension } from "../harness/types";
import { bitsToConfiguration } from "./hypotheses";
import { scoreConfiguration } from "./planner";
import type { CellPattern, ConfigurationAggregate, DiagnosisHypothesis, PlannerAction, ReplicationPolicy } from "./types";

export interface PlannedStableAction {
  action: PlannerAction;
  bits: string;
  configuration: CellPattern;
  informationScore: number;
  whySelected: string;
}

/**
 * Milestone 7's adaptive choice, made fresh before every single additional
 * coding-agent run: replicate an already-tested-but-still-unstable
 * configuration that's blocking hypothesis elimination, or try a brand new
 * configuration. Deterministic, no LLM.
 *
 * Policy (see Milestone 7 spec section 9):
 *   - Among tested configurations still under `maxRunsPerConfiguration` and
 *     still "unstable", pick the one whose predicted split across
 *     `remainingHypotheses` is most informative (same balanced-split
 *     information score as Milestone 6's selector). If that best candidate
 *     is actually decisive (informationScore > 0 — i.e. resolving it either
 *     way would change which hypotheses survive), REPLICATE it.
 *   - Otherwise, select the highest-information untested configuration,
 *     exactly as Milestone 6's `selectNextExperiment` did.
 *
 * Returns null once at most one hypothesis remains, the budget is spent, or
 * there is genuinely nothing useful left to try (nothing unstable-and-
 * decisive to replicate, and every configuration has already been tested).
 */
export function selectNextAction(
  dimensions: HarnessDimension[],
  remainingHypotheses: DiagnosisHypothesis[],
  aggregates: ConfigurationAggregate[],
  policy: ReplicationPolicy,
  remainingRunBudget: number,
): PlannedStableAction | null {
  if (remainingHypotheses.length <= 1) return null;
  if (remainingRunBudget <= 0) return null;

  let bestReplicate: PlannedStableAction | null = null;
  for (const agg of aggregates) {
    if (agg.stability !== "unstable") continue;
    if (agg.runs.length >= policy.maxRunsPerConfiguration) continue;
    const { informationScore } = scoreConfiguration(agg.configuration, remainingHypotheses);
    if (informationScore <= 0) continue;
    if (
      !bestReplicate ||
      informationScore > bestReplicate.informationScore ||
      (informationScore === bestReplicate.informationScore && agg.configurationVector < bestReplicate.bits)
    ) {
      bestReplicate = {
        action: "replicate",
        bits: agg.configurationVector,
        configuration: agg.configuration,
        informationScore,
        whySelected: `${agg.label} (${agg.configurationVector}) is still unstable after ${agg.runs.length} run(s) (failure rate ${(agg.failureRate * 100).toFixed(1)}%) and is decisive for ${remainingHypotheses.length} remaining hypotheses — replicating before trying a new configuration.`,
      };
    }
  }
  if (bestReplicate) return bestReplicate;

  const testedBits = new Set(aggregates.map((a) => a.configurationVector));
  const total = 2 ** dimensions.length;
  const allZeros = "0".repeat(dimensions.length);
  const allOnes = "1".repeat(dimensions.length);

  let bestNew: PlannedStableAction | null = null;
  for (let n = 0; n < total; n++) {
    const bits = n.toString(2).padStart(dimensions.length, "0");
    if (bits === allZeros || bits === allOnes) continue;
    if (testedBits.has(bits)) continue;

    const configuration = bitsToConfiguration(bits, dimensions);
    const { predictedPass, predictedFail, informationScore } = scoreConfiguration(configuration, remainingHypotheses);
    if (!bestNew || informationScore > bestNew.informationScore || (informationScore === bestNew.informationScore && bits < bestNew.bits)) {
      bestNew = {
        action: "new_configuration",
        bits,
        configuration,
        informationScore,
        whySelected: `Best separates ${remainingHypotheses.length} remaining hypotheses (predicted split: ${predictedPass} PASS / ${predictedFail} FAIL).`,
      };
    }
  }
  return bestNew;
}
