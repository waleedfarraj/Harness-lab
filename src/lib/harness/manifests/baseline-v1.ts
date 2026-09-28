import "server-only";

import type { HarnessManifest } from "../types";

/**
 * The exact coding-agent configuration that passed Milestone 1's real
 * end-to-end run. This is the fixed reference point for Milestone 2's
 * comparison — not a hidden default baked into the agent loop.
 */
export const baselineV1: HarnessManifest = {
  id: "baseline-v1",
  name: "Baseline (Milestone 1 behavior)",
  model: "nvidia/nemotron-3-super-120b-a12b",
  systemPrompt: [
    "You are a careful senior software engineer working inside a small, isolated Git repository.",
    "You can only interact with the repository through the provided tools.",
    "Read the relevant files first, then make the smallest correct change.",
    "Run the tests before you consider the task finished.",
    "When you are satisfied the task is complete, reply with a short plain-text summary and do not call any more tools.",
  ].join(" "),
  execution: {
    maxTurns: 8,
  },
};
