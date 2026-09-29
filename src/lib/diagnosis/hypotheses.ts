import "server-only";

import type { HarnessDimension } from "../harness/types";
import type { CellPattern, DiagnosisHypothesis, KnownCell } from "./types";

export class UnsupportedDiagnosisScopeError extends Error {
  constructor(changedDimensions: HarnessDimension[]) {
    super(
      `HarnessLab's diagnosis engine supports 1-4 changed harness dimensions ` +
        `(main effects + pairwise interactions only, no 3-way/4-way), ` +
        `found ${changedDimensions.length}: [${changedDimensions.join(", ")}]. ` +
        `Narrow baseline/candidate to fewer changed dimensions, or wait for a future milestone.`,
    );
    this.name = "UnsupportedDiagnosisScopeError";
  }
}

/** Bit-vector encoding of a configuration, in the stable order of `dimensions`: "1" = candidate value, "0" = baseline value. */
export function configurationToBits(configuration: CellPattern, dimensions: HarnessDimension[]): string {
  return dimensions.map((d) => (configuration[d] === "candidate" ? "1" : "0")).join("");
}

export function bitsToConfiguration(bits: string, dimensions: HarnessDimension[]): CellPattern {
  const configuration = {} as CellPattern;
  dimensions.forEach((dim, i) => {
    configuration[dim] = bits[i] === "1" ? "candidate" : "baseline";
  });
  return configuration;
}

/**
 * The full candidate hypothesis space for `dimensions`: one main-effect
 * hypothesis per dimension, plus one pairwise-interaction hypothesis per
 * unordered pair. Deliberately no 3-way/4-way interactions (out of scope
 * for this milestone). For 4 dimensions: 4 + 6 = 10 hypotheses.
 */
export function buildHypothesisSpace(dimensions: HarnessDimension[]): DiagnosisHypothesis[] {
  if (dimensions.length < 1 || dimensions.length > 4) {
    throw new UnsupportedDiagnosisScopeError(dimensions);
  }
  const hypotheses: DiagnosisHypothesis[] = [];
  for (const dim of dimensions) {
    hypotheses.push({ id: `main_effect:${dim}`, factors: [dim], type: "main_effect", status: "possible", evidenceFor: [], evidenceAgainst: [] });
  }
  for (let i = 0; i < dimensions.length; i++) {
    for (let j = i + 1; j < dimensions.length; j++) {
      const factors = [dimensions[i], dimensions[j]];
      hypotheses.push({ id: `interaction:${factors.join("+")}`, factors, type: "interaction", status: "possible", evidenceFor: [], evidenceAgainst: [] });
    }
  }
  return hypotheses;
}

/**
 * PREDICTION SEMANTICS (exact, tested heavily — see diagnosis-hypotheses.test.ts):
 *
 * Baseline values are assumed safe. A main-effect hypothesis on dimension X
 * predicts FAIL whenever X is at its candidate value in the configuration,
 * regardless of every other dimension. A pairwise-interaction hypothesis on
 * (X, Y) predicts FAIL only when BOTH X and Y are at their candidate value;
 * any configuration with at most one of them active is predicted PASS.
 * Every other (non-hypothesis) dimension never affects either prediction.
 *
 * Returns true for "predicted PASS", false for "predicted FAIL".
 */
export function predict(hypothesis: DiagnosisHypothesis, configuration: CellPattern): boolean {
  if (hypothesis.type === "main_effect") {
    return configuration[hypothesis.factors[0]] !== "candidate";
  }
  const allActive = hypothesis.factors.every((f) => configuration[f] === "candidate");
  return !allActive;
}

/**
 * Recomputes every hypothesis's status from scratch given the full set of
 * currently-known cells. A hypothesis is "rejected" the moment it
 * contradicts any known cell's actual outcome; otherwise it stays
 * "possible" ("supported" only once it's the single hypothesis left).
 * Stateless and deterministic — call it again after each new experiment
 * rather than mutating hypotheses incrementally.
 */
export function evaluateHypotheses(dimensions: HarnessDimension[], knownCells: KnownCell[]): DiagnosisHypothesis[] {
  const space = buildHypothesisSpace(dimensions);

  const evaluated = space.map((hypothesis): DiagnosisHypothesis => {
    const contradictions = knownCells.filter((cell) => predict(hypothesis, cell.configuration) !== cell.success);
    if (contradictions.length > 0) {
      return {
        ...hypothesis,
        status: "rejected",
        evidenceAgainst: contradictions.map(
          (c) => `${c.label} (${c.bits}): predicted ${predict(hypothesis, c.configuration) ? "PASS" : "FAIL"} but observed ${c.success ? "PASS" : "FAIL"}`,
        ),
      };
    }
    return { ...hypothesis, status: "possible" };
  });

  const possible = evaluated.filter((h) => h.status === "possible");
  if (possible.length === 1) {
    const only = possible[0];
    only.status = "supported";
    only.evidenceFor = knownCells.map((c) => `${c.label} (${c.bits}, ${c.success ? "PASS" : "FAIL"}) is consistent with this hypothesis`);
  }

  return evaluated;
}
