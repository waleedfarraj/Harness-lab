import "server-only";

import type { ContextPolicy, HarnessDimension, HarnessManifest, Skill } from "./types";

/**
 * Generic read/write for one named `HarnessDimension` on a manifest. Shared
 * by the factorial builder (Milestones 3-4) and the diagnosis planner
 * (Milestone 5) so neither has to special-case dimension names.
 */
export function getDimensionValue(manifest: HarnessManifest, dimension: HarnessDimension): unknown {
  switch (dimension) {
    case "model":
      return manifest.model;
    case "systemPrompt":
      return manifest.systemPrompt;
    case "execution.maxTurns":
      return manifest.execution.maxTurns;
    case "skills":
      return manifest.skills;
    case "contextPolicy":
      return manifest.contextPolicy;
    default:
      throw new Error(`unknown harness dimension: ${dimension satisfies never}`);
  }
}

export function applyDimension(manifest: HarnessManifest, dimension: HarnessDimension, value: unknown): HarnessManifest {
  switch (dimension) {
    case "model":
      return { ...manifest, model: value as string };
    case "systemPrompt":
      return { ...manifest, systemPrompt: value as string };
    case "execution.maxTurns":
      return { ...manifest, execution: { ...manifest.execution, maxTurns: value as number } };
    case "skills":
      return { ...manifest, skills: value as Skill[] };
    case "contextPolicy":
      return { ...manifest, contextPolicy: value as ContextPolicy };
    default:
      throw new Error(`unknown harness dimension: ${dimension satisfies never}`);
  }
}
