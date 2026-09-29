import "server-only";

import { baselineSkill } from "../skills/baseline-skill";
import type { HarnessManifest } from "../types";

/**
 * Differs from `baselineV1` in exactly one dimension: systemPrompt. Same
 * model, same execution.maxTurns. The instruction pushes toward less
 * exploration and a single validation pass, not toward failure — a
 * realistic prompt variant, not a sabotaged one.
 */
export const candidateMinimalV1: HarnessManifest = {
  id: "candidate-minimal-v1",
  name: "Candidate (minimize exploration)",
  model: "nvidia/nemotron-3-super-120b-a12b",
  systemPrompt: [
    "You are a careful senior software engineer working inside a small, isolated Git repository.",
    "You can only interact with the repository through the provided tools.",
    "Minimize unnecessary repository exploration and make the smallest implementation needed from the task description.",
    "Run relevant validation once you believe the implementation is complete.",
    "When you are satisfied the task is complete, reply with a short plain-text summary and do not call any more tools.",
  ].join(" "),
  execution: {
    maxTurns: 8,
  },
  skills: [baselineSkill],
  contextPolicy: "full",
};
