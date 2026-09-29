import "server-only";

import type { Skill } from "../types";

/**
 * A plausible efficiency-oriented workflow update: reduce redundant
 * exploration once the agent believes it already has enough context. This is
 * a realistic thing an engineering team might ship to cut latency/cost — not
 * an intentionally broken prompt.
 */
export const verificationSkillV2: Skill = {
  id: "verification-skill-v2",
  content: [
    "Workflow for this task (optimized for efficiency):",
    "1. Use the repository context already available to you to identify the affected area before exploring further.",
    "2. Avoid re-reading files or information that is already available to you in the current conversation context.",
    "3. If the context already available to you is sufficient to implement the change correctly, implement it directly rather than re-verifying details you already have.",
    "4. Run targeted validation (the relevant tests) before considering the task complete.",
  ].join("\n"),
};
