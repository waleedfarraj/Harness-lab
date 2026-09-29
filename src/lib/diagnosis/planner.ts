import "server-only";

import type { HarnessDimension } from "../harness/types";
import { isIsolating, isolationConfiguration } from "./hypotheses";
import type { CellPattern, Diagnosis, DiagnosisHypothesis, KnownCell } from "./types";

export interface PlannedExperiment {
  configuration: CellPattern;
  whySelected: string;
}

/**
 * Decides the next experiment needed to distinguish the remaining
 * hypotheses, or `null` if no more are needed (either because a hypothesis
 * is already conclusively supported, or the experiment budget is spent).
 * Generic over `dimensions` — never references a dimension name directly.
 */
export function selectNextExperiment(dimensions: HarnessDimension[], knownCells: KnownCell[], remainingBudget: number): PlannedExperiment | null {
  if (dimensions.length === 1) return null; // fully resolved from baseline/candidate alone
  if (remainingBudget <= 0) return null;

  const [dimA, dimB] = dimensions;
  const cellA = knownCells.find((c) => isIsolating(c.configuration, dimA, dimensions));
  const cellB = knownCells.find((c) => isIsolating(c.configuration, dimB, dimensions));

  if (!cellA) {
    return {
      configuration: isolationConfiguration(dimA, dimensions, "candidate"),
      whySelected: `Distinguishes whether ${dimA} alone reproduces the regression (main effect) from the ${dimB}/interaction hypotheses.`,
    };
  }
  if (!cellA.success) {
    // dimA alone already reproduces the failure -- a sufficient explanation is already found (parsimony);
    // stop here rather than spending a second experiment to also characterize dimB.
    return null;
  }
  if (!cellB) {
    return {
      configuration: isolationConfiguration(dimB, dimensions, "candidate"),
      whySelected: `${dimA} alone was safe. Distinguishes whether ${dimB} alone reproduces the regression (main effect) from the interaction hypothesis.`,
    };
  }
  return null; // both isolating cells known; hypotheses are fully resolved
}

/** Final classification from a set of hypotheses. Exactly one "supported" hypothesis resolves cleanly; zero or more than one is inconclusive. */
export function classifyDiagnosis(hypotheses: DiagnosisHypothesis[]): Diagnosis {
  const supported = hypotheses.filter((h) => h.status === "supported");
  if (supported.length === 1) {
    const h = supported[0];
    return h.type === "main_effect" ? { type: "main_effect", factors: h.factors } : { type: "interaction", factors: h.factors };
  }
  if (supported.length > 1) {
    return { type: "inconclusive", reason: `multiple hypotheses are independently supported: ${supported.map((h) => h.id).join(", ")}` };
  }
  return { type: "inconclusive", reason: "not enough evidence yet to support any single hypothesis" };
}
