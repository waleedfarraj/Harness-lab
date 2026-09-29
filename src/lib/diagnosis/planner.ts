import "server-only";

import type { HarnessDimension } from "../harness/types";
import { bitsToConfiguration, predict } from "./hypotheses";
import type { CellPattern, Diagnosis, DiagnosisHypothesis } from "./types";

export interface PlannedExperiment {
  bits: string;
  configuration: CellPattern;
  informationScore: number;
  predictedPass: number;
  predictedFail: number;
  whySelected: string;
}

/** How many hypotheses in `remaining` predict PASS vs FAIL for `configuration`. */
export function scoreConfiguration(configuration: CellPattern, remaining: DiagnosisHypothesis[]): { predictedPass: number; predictedFail: number; informationScore: number } {
  let predictedPass = 0;
  let predictedFail = 0;
  for (const h of remaining) {
    if (predict(h, configuration)) predictedPass += 1;
    else predictedFail += 1;
  }
  return { predictedPass, predictedFail, informationScore: Math.min(predictedPass, predictedFail) };
}

/**
 * Adaptive experiment selection: among every untested, non-baseline,
 * non-candidate configuration, picks the one whose predicted PASS/FAIL
 * split across the still-`possible` hypotheses is closest to balanced
 * (highest `informationScore` = min(predictedPass, predictedFail)) — a
 * deterministic approximation of maximum information gain, with no LLM
 * involved. Ties break on the lexicographically smallest bit string, so
 * the same inputs always choose the same experiment.
 *
 * Returns null once at most one hypothesis remains (nothing left to
 * distinguish), the budget is spent, or every configuration has been
 * tested.
 */
export function selectNextExperiment(
  dimensions: HarnessDimension[],
  remainingHypotheses: DiagnosisHypothesis[],
  testedBits: Set<string>,
  remainingBudget: number,
): PlannedExperiment | null {
  if (remainingHypotheses.length <= 1) return null;
  if (remainingBudget <= 0) return null;

  const total = 2 ** dimensions.length;
  const allZeros = "0".repeat(dimensions.length);
  const allOnes = "1".repeat(dimensions.length);

  let best: PlannedExperiment | null = null;
  for (let n = 0; n < total; n++) {
    const bits = n.toString(2).padStart(dimensions.length, "0");
    if (bits === allZeros || bits === allOnes) continue; // baseline/candidate: already known
    if (testedBits.has(bits)) continue;

    const configuration = bitsToConfiguration(bits, dimensions);
    const { predictedPass, predictedFail, informationScore } = scoreConfiguration(configuration, remainingHypotheses);
    if (!best || informationScore > best.informationScore || (informationScore === best.informationScore && bits < best.bits)) {
      best = {
        bits,
        configuration,
        informationScore,
        predictedPass,
        predictedFail,
        whySelected: `Best separates ${remainingHypotheses.length} remaining hypotheses (predicted split: ${predictedPass} PASS / ${predictedFail} FAIL).`,
      };
    }
  }
  return best;
}

/** Final classification from a fully-evaluated hypothesis set. Exactly one non-rejected hypothesis resolves cleanly; zero or more than one is inconclusive. */
export function classifyDiagnosis(hypotheses: DiagnosisHypothesis[]): Diagnosis {
  const remaining = hypotheses.filter((h) => h.status !== "rejected");
  if (remaining.length === 1) {
    const h = remaining[0];
    return h.type === "main_effect" ? { type: "main_effect", factors: h.factors } : { type: "interaction", factors: h.factors };
  }
  if (remaining.length === 0) {
    return {
      type: "inconclusive",
      reason: "no main-effect or pairwise-interaction hypothesis is consistent with the observed results; a higher-order interaction may be responsible, which this model does not represent",
    };
  }
  return {
    type: "inconclusive",
    reason: `${remaining.length} hypotheses remain consistent with the evidence collected so far: ${remaining.map((h) => h.id).join(", ")}`,
  };
}
