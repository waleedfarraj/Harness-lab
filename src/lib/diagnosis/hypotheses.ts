import "server-only";

import type { HarnessDimension } from "../harness/types";
import type { CellPattern, DiagnosisHypothesis, KnownCell } from "./types";

export class UnsupportedDiagnosisScopeError extends Error {
  constructor(changedDimensions: HarnessDimension[]) {
    super(
      `HarnessLab's diagnosis MVP supports exactly 1 or 2 changed harness dimensions, ` +
        `found ${changedDimensions.length}: [${changedDimensions.join(", ")}]. ` +
        `Narrow baseline/candidate to fewer changed dimensions, or wait for a future milestone.`,
    );
    this.name = "UnsupportedDiagnosisScopeError";
  }
}

/** True if `configuration` isolates `dimension` alone: candidate on that dimension, baseline on every other changed dimension. */
export function isIsolating(configuration: CellPattern, dimension: HarnessDimension, allDimensions: HarnessDimension[]): boolean {
  if (configuration[dimension] !== "candidate") return false;
  return allDimensions.filter((d) => d !== dimension).every((d) => configuration[d] === "baseline");
}

/** The configuration that isolates one dimension at `value`, holding every other changed dimension at "baseline". */
export function isolationConfiguration(dimension: HarnessDimension, allDimensions: HarnessDimension[], value: "baseline" | "candidate"): CellPattern {
  const configuration = {} as CellPattern;
  for (const d of allDimensions) configuration[d] = d === dimension ? value : "baseline";
  return configuration;
}

function findIsolatingCell(knownCells: KnownCell[], dimension: HarnessDimension, allDimensions: HarnessDimension[]): KnownCell | undefined {
  return knownCells.find((cell) => isIsolating(cell.configuration, dimension, allDimensions));
}

/**
 * Recomputes every hypothesis's status from scratch given the full set of
 * currently-known cells (baseline, candidate, and any diagnostic
 * experiments run so far). Stateless and deterministic — call it again
 * after each new experiment rather than mutating hypotheses incrementally.
 *
 * Operates on `dimensions` generically; never references a dimension name
 * (e.g. "skills") directly.
 */
export function evaluateHypotheses(dimensions: HarnessDimension[], knownCells: KnownCell[]): DiagnosisHypothesis[] {
  if (dimensions.length !== 1 && dimensions.length !== 2) {
    throw new UnsupportedDiagnosisScopeError(dimensions);
  }

  if (dimensions.length === 1) {
    const [dim] = dimensions;
    const isolating = findIsolatingCell(knownCells, dim, dimensions);
    const status = !isolating ? "possible" : isolating.success ? "rejected" : "supported";
    const hypothesis: DiagnosisHypothesis = {
      id: `main_effect:${dim}`,
      factors: [dim],
      type: "main_effect",
      status,
      evidenceFor: status === "supported" && isolating ? [`${isolating.label} (${dim} alone at candidate value) failed`] : [],
      evidenceAgainst: status === "rejected" && isolating ? [`${isolating.label} (${dim} alone at candidate value) passed`] : [],
    };
    return [hypothesis];
  }

  const [dimA, dimB] = dimensions;
  const cellA = findIsolatingCell(knownCells, dimA, dimensions);
  const cellB = findIsolatingCell(knownCells, dimB, dimensions);

  const statusA = !cellA ? "possible" : cellA.success ? "rejected" : "supported";
  const statusB = !cellB ? "possible" : cellB.success ? "rejected" : "supported";

  const mainA: DiagnosisHypothesis = {
    id: `main_effect:${dimA}`,
    factors: [dimA],
    type: "main_effect",
    status: statusA,
    evidenceFor: statusA === "supported" && cellA ? [`${cellA.label} (${dimA} alone at candidate value) failed`] : [],
    evidenceAgainst: statusA === "rejected" && cellA ? [`${cellA.label} (${dimA} alone at candidate value) passed`] : [],
  };
  const mainB: DiagnosisHypothesis = {
    id: `main_effect:${dimB}`,
    factors: [dimB],
    type: "main_effect",
    status: statusB,
    evidenceFor: statusB === "supported" && cellB ? [`${cellB.label} (${dimB} alone at candidate value) failed`] : [],
    evidenceAgainst: statusB === "rejected" && cellB ? [`${cellB.label} (${dimB} alone at candidate value) passed`] : [],
  };

  let interactionStatus: DiagnosisHypothesis["status"] = "possible";
  const interactionFor: string[] = [];
  const interactionAgainst: string[] = [];

  if (statusA === "supported" || statusB === "supported") {
    interactionStatus = "rejected";
    if (statusA === "supported") interactionAgainst.push(`${dimA} alone already reproduces the failure, so no interaction is needed to explain it`);
    if (statusB === "supported") interactionAgainst.push(`${dimB} alone already reproduces the failure, so no interaction is needed to explain it`);
  } else if (statusA === "rejected" && statusB === "rejected") {
    interactionStatus = "supported";
    interactionFor.push(`${dimA} alone is safe, ${dimB} alone is safe, but the combination (the candidate) fails`);
  }

  const interaction: DiagnosisHypothesis = {
    id: `interaction:${dimA}+${dimB}`,
    factors: [dimA, dimB],
    type: "interaction",
    status: interactionStatus,
    evidenceFor: interactionFor,
    evidenceAgainst: interactionAgainst,
  };

  return [mainA, mainB, interaction];
}
