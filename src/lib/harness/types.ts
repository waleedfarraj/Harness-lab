import "server-only";

export interface Skill {
  id: string;
  content: string;
}

export type ContextPolicy = "full" | "compact";

/**
 * A first-class, explicit description of the coding-agent configuration an
 * experiment runs under. `skills` and `contextPolicy` (Milestone 4) are real
 * harness components, not labels: `skills` content is injected into the
 * agent's instructions, and `contextPolicy` genuinely changes what the model
 * sees on later turns (see `applyContextPolicy` in coding-agent.ts).
 */
export interface HarnessManifest {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  execution: {
    maxTurns: number;
  };
  skills: Skill[];
  contextPolicy: ContextPolicy;
}

/** Field paths considered a "harness dimension" for controlled-experiment purposes. */
export const HARNESS_DIMENSIONS = ["model", "systemPrompt", "execution.maxTurns", "skills", "contextPolicy"] as const;
export type HarnessDimension = (typeof HARNESS_DIMENSIONS)[number];
