import "server-only";

import path from "node:path";
import { discountApplyTask } from "../experiments/tasks/discount-apply";
import { paymentRetryTask } from "../experiments/tasks/payment-retry";
import { durationParseTask } from "../experiments/tasks/duration-parse";
import { baselineV1 } from "../harness/manifests/baseline-v1";
import { baselineSkill } from "../harness/skills/baseline-skill";
import { verificationSkillV2 } from "../harness/skills/verification-skill-v2";
import type { HarnessManifest } from "../harness/types";
import type { ReplicationPolicy } from "../diagnosis/types";
import { DIAGNOSES_DIR } from "../experiments/evidence";
import type { BenchmarkCase } from "./types";

/**
 * Byte-for-byte identical to the system prompt scripts/diagnose-stable.ts and
 * src/lib/demo/evidence-catalog.ts use: a verified-benign distractor (tone /
 * closing-format only — the read-the-files-first guidance sentence is
 * unchanged from baselineV1) observed across several real runs never to be
 * the responsible factor on its own.
 */
const TONE_VARIANT_SYSTEM_PROMPT = [
  "You are a meticulous senior software engineer working inside a small, isolated Git repository.",
  "You can only interact with the repository through the provided tools.",
  "Read the relevant files first, then make the smallest correct change.",
  "Run the tests before you consider the task finished.",
  "When you are satisfied the task is complete, reply with exactly two sentences summarizing what changed and why, then stop calling tools.",
].join(" ");

const TWO_DIM_POLICY: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 10, reservedConfirmationRuns: 2 };
const ONE_DIM_POLICY: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 8, reservedConfirmationRuns: 1 };
const THREE_DIM_POLICY: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 14, reservedConfirmationRuns: 2 };
const FOUR_DIM_POLICY: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 10, reservedConfirmationRuns: 2 };

function manifest(overrides: Partial<HarnessManifest> & { id: string; name: string }): HarnessManifest {
  return { ...baselineV1, ...overrides };
}

export const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "interaction-discount-apply",
    name: "Scenario A — Interaction (hero candidate)",
    description:
      "Two individually-safe harness changes (an efficiency-oriented skill + compact context) together drop the contract's expiry-reporting detail. Each has been real-evidenced as the true cause under the legacy schema; this reruns the exact same 2-dimension change under the current replicated-evidence schema, where it's mathematically resolvable within budget (unlike the 4-dimension version of this same mechanism, which needs 12 replicated runs against a 10-run budget).",
    task: discountApplyTask,
    baseline: manifest({ id: "bench-interaction-baseline", name: "baseline-skill + full-context", skills: [baselineSkill], contextPolicy: "full" }),
    candidate: manifest({ id: "bench-interaction-candidate", name: "verification-skill-v2 + compact-context", skills: [verificationSkillV2], contextPolicy: "compact" }),
    replication: TWO_DIM_POLICY,
    expectedShape: "interaction",
  },
  {
    id: "main-effect-payment-retry",
    name: "Scenario B — Main effect (hero candidate)",
    description:
      "A new fixture (payment-retry). The efficiency-oriented skill is the hypothesized true cause (it discourages re-reading the attemptPayment failure-kind contract in src/paymentRetry.ts before implementing); a tone-only system-prompt change is the benign distractor.",
    task: paymentRetryTask,
    baseline: manifest({ id: "bench-main-effect-baseline", name: "baseline-skill + baseline prompt", skills: [baselineSkill] }),
    candidate: manifest({ id: "bench-main-effect-candidate", name: "verification-skill-v2 + tone-variant prompt", skills: [verificationSkillV2], systemPrompt: TONE_VARIANT_SYSTEM_PROMPT }),
    replication: TWO_DIM_POLICY,
    expectedShape: "main_effect",
  },
  {
    id: "benign-duration-parse",
    name: "Scenario C — Benign candidate",
    description:
      "A new fixture (duration-parse, modeled on the real `ms` npm package's documented behavior — see fixtures/duration-parse/THIRD_PARTY_NOTICES.md). Only the already-proven-benign tone-only system-prompt distractor changes; HarnessLab is expected to detect no regression and stop before running any diagnostic experiments.",
    task: durationParseTask,
    baseline: manifest({ id: "bench-benign-baseline", name: "baseline-skill + baseline prompt", skills: [baselineSkill] }),
    candidate: manifest({ id: "bench-benign-candidate", name: "baseline-skill + tone-variant prompt", skills: [baselineSkill], systemPrompt: TONE_VARIANT_SYSTEM_PROMPT }),
    replication: ONE_DIM_POLICY,
    expectedShape: "no_regression",
  },
  {
    id: "stochastic-discount-apply",
    name: "Scenario D — Stochastic / unstable (reused evidence)",
    description:
      "Reuses an already-recorded real diagnosis instead of spending a fresh run budget: discount-apply-001 with all 4 dimensions changed (systemPrompt, execution.maxTurns, skills, contextPolicy) — the same real skills x contextPolicy interaction as Scenario A, but at 4 dimensions the search space needs 12 replicated runs to fully resolve against a 10-run budget, so every real run of this exact configuration (5 of them, independently) has honestly landed on the same inconclusive result. This is the repo's existing default evidence (see src/lib/demo/evidence-catalog.ts, key \"inconclusive\").",
    task: discountApplyTask,
    baseline: manifest({ id: "diagnosis-stable-baseline", name: "baseline-skill + full-context + baseline-prompt + maxTurns=8", skills: [baselineSkill], contextPolicy: "full" }),
    candidate: manifest({
      id: "diagnosis-stable-candidate",
      name: "verification-skill-v2 + compact-context + tone-only-prompt + maxTurns=9",
      skills: [verificationSkillV2],
      contextPolicy: "compact",
      systemPrompt: TONE_VARIANT_SYSTEM_PROMPT,
      execution: { maxTurns: 9 },
    }),
    replication: FOUR_DIM_POLICY,
    expectedShape: "unstable",
    existingEvidencePath: path.join(DIAGNOSES_DIR, "31fa36e3-c6ab-4279-bbe6-debb02e900e2.json"),
  },
  {
    id: "distractor-heavy-duration-parse",
    name: "Scenario E — Controlled seeded regression (hero-main-effect-v1)",
    description:
      "Controlled seeded harness regression, not a natural/exploratory sample: duration-parse with exactly 3 changed dimensions (skills, systemPrompt, execution.maxTurns — contextPolicy deliberately untouched). skills (verification-skill-v2) is the seeded true cause — a plausible, reusable 'avoid re-reading files/context you already have' efficiency heuristic that is systematically incompatible with this task's one requirement stated only in durationContract.ts and never exercised by the public tests (the MAX_INPUT_LENGTH guard). systemPrompt (tone-only) and execution.maxTurns (8 -> 9, strictly more budget) are benign distractors already proven harmless elsewhere in this repo. See the benchmark brief for the full controlled-regression design writeup.",
    task: durationParseTask,
    baseline: manifest({ id: "bench-distractor-baseline", name: "baseline-skill + baseline prompt + maxTurns=8", skills: [baselineSkill] }),
    candidate: manifest({
      id: "bench-distractor-candidate",
      name: "verification-skill-v2 + tone-variant prompt + maxTurns=9",
      skills: [verificationSkillV2],
      systemPrompt: TONE_VARIANT_SYSTEM_PROMPT,
      execution: { maxTurns: 9 },
    }),
    replication: THREE_DIM_POLICY,
    expectedShape: "main_effect",
    controlledSeeded: true,
    expectedFactors: ["skills"],
    heroCaseId: "hero-main-effect-v1",
  },
];
