import "server-only";

import type { Skill } from "../types";

/**
 * ApplyPilot-AI's own job-evaluation guidance, condensed from
 * ApplyPilot-AI/.claude/skills/job-evaluation/SKILL.md (its "Must-not" rules
 * and testing requirements) plus the workflow step that makes those rules
 * bind: read the domain contract before writing ordering/scoring code. This is
 * the "job-matching skill" of the ApplyPilot harness.
 */
export const applypilotJobEvaluationSkill: Skill = {
  id: "applypilot-job-evaluation-v1",
  content: [
    "ApplyPilot job-evaluation rules (apply them to any ranking, scoring or matching code):",
    "1. Read the domain contract file for the module you are changing and implement every rule in it, in the order it states them. Do not rely on the public tests alone; they are a subset.",
    "2. Never treat silence as qualification, and never treat unknown as blocked: an unknown or unconfirmed fact keeps its own tier between 'confirmed' and 'blocked'.",
    "3. A candidate must not be pointed at a role they cannot take: eligibility blockers outrank raw score.",
    "4. A pending (not yet evaluated) job has no score; it is never ranked as if it had a low score.",
    "5. Results must be reproducible: break every tie deterministically and do not mutate inputs.",
    "6. Before finishing, re-check your implementation against each numbered rule in the contract, then run the tests and the build.",
  ].join("\n"),
};
