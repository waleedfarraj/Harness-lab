import "server-only";

import { applypilotJobEvaluationSkill } from "../skills/applypilot-job-evaluation-skill";
import { verificationSkillV2 } from "../skills/verification-skill-v2";
import type { HarnessManifest } from "../types";
import { baselineV1 } from "./baseline-v1";

/** ApplyPilot's own job-evaluation guidance, full context: the "known good" harness. */
export const applypilotBaseline: HarnessManifest = {
  ...baselineV1,
  id: "applypilot-baseline",
  name: "ApplyPilot job-evaluation skill + full context",
  skills: [applypilotJobEvaluationSkill],
  contextPolicy: "full",
};

/** A plausible efficiency change: swap the domain skill for a generic one and compact context. Same model, prompt, maxTurns. */
export const applypilotCandidate: HarnessManifest = {
  ...baselineV1,
  id: "applypilot-candidate",
  name: "generic efficiency skill + compact context",
  skills: [verificationSkillV2],
  contextPolicy: "compact",
};
