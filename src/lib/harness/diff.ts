import "server-only";

import { HARNESS_DIMENSIONS, type HarnessDimension, type HarnessManifest } from "./types";

/** Which harness dimensions differ between two manifests. `id`/`name` are labels, not dimensions, and are ignored. */
export function diffManifests(a: HarnessManifest, b: HarnessManifest): HarnessDimension[] {
  const changed: HarnessDimension[] = [];
  if (a.model !== b.model) changed.push("model");
  if (a.systemPrompt !== b.systemPrompt) changed.push("systemPrompt");
  if (a.execution.maxTurns !== b.execution.maxTurns) changed.push("execution.maxTurns");
  if (JSON.stringify(a.skills) !== JSON.stringify(b.skills)) changed.push("skills");
  if (a.contextPolicy !== b.contextPolicy) changed.push("contextPolicy");
  return changed;
}

export class UncontrolledExperimentError extends Error {
  constructor(expected: string[], actual: string[]) {
    const unintended = actual.filter((d) => !expected.includes(d));
    const missing = expected.filter((d) => !actual.includes(d));
    const parts = [
      `expected exactly [${expected.join(", ") || "(none)"}] to differ, but found [${actual.join(", ") || "(none)"}] differing`,
    ];
    if (unintended.length > 0) parts.push(`unintended: ${unintended.join(", ")}`);
    if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
    super(`Harness manifests are not a controlled experiment: ${parts.join("; ")}`);
    this.name = "UncontrolledExperimentError";
  }
}

/** Throws unless the two manifests differ in exactly the expected dimensions — nothing more, nothing less. */
export function assertControlledExperiment(
  baseline: HarnessManifest,
  candidate: HarnessManifest,
  expectedChangedDimensions: HarnessDimension[],
): HarnessDimension[] {
  const actual = diffManifests(baseline, candidate);
  const expectedSet = new Set(expectedChangedDimensions);
  const actualSet = new Set(actual);
  const isControlled =
    actual.length === expectedChangedDimensions.length && actual.every((d) => expectedSet.has(d)) && expectedChangedDimensions.every((d) => actualSet.has(d));
  if (!isControlled) {
    throw new UncontrolledExperimentError(expectedChangedDimensions, actual);
  }
  return actual;
}

export { HARNESS_DIMENSIONS };
