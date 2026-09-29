import "server-only";

import type { Skill } from "../types";

/** The existing, already-proven workflow (Milestones 1-3.5 used this pattern implicitly). */
export const baselineSkill: Skill = {
  id: "baseline-skill-v1",
  content: [
    "Workflow for this task:",
    "1. Inspect the current implementation.",
    "2. Inspect the relevant tests and any nearby contract or utility files that describe expected behavior.",
    "3. Make the minimal change needed to satisfy the requirements.",
    "4. Run the relevant validation before considering the task complete.",
  ].join("\n"),
};
