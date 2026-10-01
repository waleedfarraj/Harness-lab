import "server-only";

import path from "node:path";
import { baselineV1 } from "../harness/manifests/baseline-v1";
import { baselineSkill } from "../harness/skills/baseline-skill";
import { verificationSkillV2 } from "../harness/skills/verification-skill-v2";
import type { HarnessManifest } from "../harness/types";
import { DIAGNOSES_DIR } from "../experiments/evidence";

/**
 * Curated pointers into real, previously recorded `.harnesslab/diagnoses/*.json`
 * evidence — never synthesized. Each entry's baseline/candidate manifest is
 * copied verbatim from the script that actually produced that evidence file
 * (`manifestId` on the file's own baseline/candidate result confirms the
 * match; see each entry's comment), so the harness-diff UI can show literal
 * skill/prompt/maxTurns values even though neither diagnosis schema stores
 * the full manifest for baseline/candidate itself (only their `manifestId`
 * string + the per-dimension `CellPattern`).
 */

const TASK_TITLE = "Implement discount code application";
const TASK_INSTRUCTION =
  "Implement applyDiscount in src/applyDiscount.ts against the catalog lookup, minimum-spend, and expiry rules documented in src/discountContract.ts.";

/** Byte-for-byte identical between scripts/diagnose-adaptive.ts and scripts/diagnose-stable.ts's candidate. */
const TONE_VARIANT_SYSTEM_PROMPT = [
  "You are a meticulous senior software engineer working inside a small, isolated Git repository.",
  "You can only interact with the repository through the provided tools.",
  "Read the relevant files first, then make the smallest correct change.",
  "Run the tests before you consider the task finished.",
  "When you are satisfied the task is complete, reply with exactly two sentences summarizing what changed and why, then stop calling tools.",
].join(" ");

function fourDimBaseline(id: string): HarnessManifest {
  return { ...baselineV1, id, skills: [baselineSkill], contextPolicy: "full" };
}

function fourDimCandidate(id: string, maxTurns: number): HarnessManifest {
  return { ...baselineV1, id, skills: [verificationSkillV2], contextPolicy: "compact", systemPrompt: TONE_VARIANT_SYSTEM_PROMPT, execution: { maxTurns } };
}

export interface DemoEvidenceEntry {
  key: string;
  label: string;
  description: string;
  filePath: string;
  taskTitle: string;
  taskInstruction: string;
  baselineManifest: HarnessManifest;
  candidateManifest: HarnessManifest;
}

/**
 * `inconclusive` is the default (see `DEFAULT_DEMO_EVIDENCE_KEY`): it is the
 * only real, live-Nebius-Sandbox, current-schema (replicated-evidence)
 * example on disk that also has 4 changed dimensions — every other 4-dim
 * real run in this schema also resolved inconclusive (see the repo's
 * `.harnesslab/diagnoses/` — none of the Milestone 7-9 discount-apply-001
 * runs against a real Token Factory Sandbox landed on main_effect/interaction
 * within budget). `main-effect` and `interaction` are real decisive
 * diagnoses recorded by the Milestone 6 engine (before replication/stability
 * tracking existed) — see `schemaSource: "legacy"` on their view model.
 */
export const DEMO_EVIDENCE: DemoEvidenceEntry[] = [
  {
    key: "inconclusive",
    label: "Inconclusive",
    description: "4 dimensions changed, replicated evidence, budget exhausted before a unique cause could be confirmed.",
    // scripts/diagnose-stable.ts, manifestId "diagnosis-stable-baseline"/"diagnosis-stable-candidate".
    filePath: path.join(DIAGNOSES_DIR, "31fa36e3-c6ab-4279-bbe6-debb02e900e2.json"),
    taskTitle: TASK_TITLE,
    taskInstruction: TASK_INSTRUCTION,
    baselineManifest: fourDimBaseline("diagnosis-stable-baseline"),
    candidateManifest: fourDimCandidate("diagnosis-stable-candidate", 9),
  },
  {
    key: "main-effect",
    label: "Main effect",
    description: "4 dimensions changed; the deterministic engine isolated a single responsible dimension.",
    // scripts/diagnose-adaptive.ts, manifestId "diagnosis4-baseline"/"diagnosis4-candidate".
    filePath: path.join(DIAGNOSES_DIR, "f148f9b5-2ed9-46e4-b252-27092049d3e6.json"),
    taskTitle: TASK_TITLE,
    taskInstruction: TASK_INSTRUCTION,
    baselineManifest: fourDimBaseline("diagnosis4-baseline"),
    candidateManifest: fourDimCandidate("diagnosis4-candidate", 9),
  },
  {
    key: "interaction",
    label: "Interaction",
    description: "2 dimensions changed; neither alone explains the regression, but the combination does.",
    // scripts/diagnose-smoke.ts, manifestId "diagnosis-baseline"/"diagnosis-candidate".
    filePath: path.join(DIAGNOSES_DIR, "a7051dd3-92ac-4a84-b137-f7b3365eaed7.json"),
    taskTitle: TASK_TITLE,
    taskInstruction: TASK_INSTRUCTION,
    baselineManifest: { ...baselineV1, id: "diagnosis-baseline", skills: [baselineSkill], contextPolicy: "full" },
    candidateManifest: { ...baselineV1, id: "diagnosis-candidate", skills: [verificationSkillV2], contextPolicy: "compact" },
  },
];

export const DEFAULT_DEMO_EVIDENCE_KEY = "inconclusive";

export function findDemoEvidence(key: string | undefined): DemoEvidenceEntry | undefined {
  return DEMO_EVIDENCE.find((e) => e.key === key);
}
