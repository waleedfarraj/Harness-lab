import "server-only";

import { diffManifests } from "./diff";
import type { HarnessDimension, HarnessManifest } from "./types";

/**
 * A 2-level factor: one harness dimension, and the two values to test it at.
 * Milestone 3 only needs two binary factors — this is not a general N-way
 * design-of-experiments tool.
 */
export interface FactorDefinition<T = unknown> {
  name: HarnessDimension;
  baselineValue: T;
  candidateValue: T;
}

export type FactorLevel = "baseline" | "candidate";

export interface FactorialCell {
  id: string;
  /** Which level each factor is at in this cell, e.g. { systemPrompt: "baseline", "execution.maxTurns": "candidate" }. */
  factors: Record<string, FactorLevel>;
  manifest: HarnessManifest;
}

export interface FactorialExperiment {
  taskId: string;
  factors: FactorDefinition[];
  cells: FactorialCell[];
}

function applyDimension(manifest: HarnessManifest, dimension: HarnessDimension, value: unknown): HarnessManifest {
  switch (dimension) {
    case "model":
      return { ...manifest, model: value as string };
    case "systemPrompt":
      return { ...manifest, systemPrompt: value as string };
    case "execution.maxTurns":
      return { ...manifest, execution: { ...manifest.execution, maxTurns: value as number } };
    default:
      throw new Error(`unknown harness dimension: ${dimension satisfies never}`);
  }
}

/**
 * Builds all 2^2 = 4 cells for exactly two factors, starting from
 * `baseManifest` and overriding only the two factor dimensions per cell.
 * By construction, no other field of `baseManifest` can vary between cells.
 */
export function buildFactorialExperiment(
  taskId: string,
  baseManifest: HarnessManifest,
  factors: [FactorDefinition, FactorDefinition],
): FactorialExperiment {
  const [factorA, factorB] = factors;
  const levels: FactorLevel[] = ["baseline", "candidate"];
  const cells: FactorialCell[] = [];

  for (const levelA of levels) {
    for (const levelB of levels) {
      const valueA = levelA === "baseline" ? factorA.baselineValue : factorA.candidateValue;
      const valueB = levelB === "baseline" ? factorB.baselineValue : factorB.candidateValue;
      const withA = applyDimension(baseManifest, factorA.name, valueA);
      const withBoth = applyDimension(withA, factorB.name, valueB);
      const id = `${factorA.name}=${levelA},${factorB.name}=${levelB}`;
      cells.push({
        id,
        factors: { [factorA.name]: levelA, [factorB.name]: levelB },
        manifest: { ...withBoth, id, name: id },
      });
    }
  }

  return { taskId, factors, cells };
}

export class UncontrolledFactorialExperimentError extends Error {
  constructor(expected: HarnessDimension[], actual: HarnessDimension[]) {
    const unintended = actual.filter((d) => !expected.includes(d));
    const missing = expected.filter((d) => !actual.includes(d));
    const parts = [`expected exactly [${expected.join(", ")}] to vary across cells, but found [${actual.join(", ") || "(none)"}]`];
    if (unintended.length > 0) parts.push(`unintended: ${unintended.join(", ")}`);
    if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
    super(`Factorial experiment is not controlled: ${parts.join("; ")}`);
    this.name = "UncontrolledFactorialExperimentError";
  }
}

/**
 * Fails fast (before any model call) unless the union of dimensions that
 * differ across every pair of cells is exactly `expectedDimensions`.
 */
export function assertControlledFactorialExperiment(cells: FactorialCell[], expectedDimensions: HarnessDimension[]): void {
  const varying = new Set<HarnessDimension>();
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      for (const dimension of diffManifests(cells[i].manifest, cells[j].manifest)) varying.add(dimension);
    }
  }
  const actual = [...varying];
  const isControlled =
    actual.length === expectedDimensions.length && actual.every((d) => expectedDimensions.includes(d));
  if (!isControlled) {
    throw new UncontrolledFactorialExperimentError(expectedDimensions, actual);
  }
}
