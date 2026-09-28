import "server-only";

/**
 * A first-class, explicit description of the coding-agent configuration an
 * experiment runs under. Intentionally small: Milestone 2 only needs enough
 * to vary one axis (the system prompt) and compare. MCP, permissions,
 * skills, context policy, and memory are future axes, not fields to leave
 * unused here.
 */
export interface HarnessManifest {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  execution: {
    maxTurns: number;
  };
}

/** Field paths considered a "harness dimension" for controlled-experiment purposes. */
export const HARNESS_DIMENSIONS = ["model", "systemPrompt", "execution.maxTurns"] as const;
export type HarnessDimension = (typeof HARNESS_DIMENSIONS)[number];
