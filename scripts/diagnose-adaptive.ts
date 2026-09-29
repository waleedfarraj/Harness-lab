// Milestone 6 adaptive diagnosis run: 4 changed harness dimensions (skills,
// contextPolicy, systemPrompt, execution.maxTurns), 16 theoretical
// configurations. skills x contextPolicy remains the real regression
// mechanism (unchanged from Milestone 4/5); systemPrompt and
// execution.maxTurns are realistic-looking, individually-safe benign
// distractors, not required for the failure. The adaptive planner is
// generic over 1-4 changed dimensions — nothing here hard-codes which
// dimension(s) turn out to matter.
//
// Live-call budget: 2 (baseline + candidate) + up to 6 additional diagnostic
// experiments (maxExperiments=6) = up to 8 real coding-agent calls, plus
// exactly 1 real Nemotron explanation call once the classification is fixed.
// Run it deliberately, not in a loop; do not auto-retry on a surprising or
// stochastic result.
import path from "node:path";
import { runDiagnosis } from "../src/lib/diagnosis/diagnose";
import { discountApplyTask } from "../src/lib/experiments/tasks/discount-apply";
import { baselineV1 } from "../src/lib/harness/manifests/baseline-v1";
import { baselineSkill } from "../src/lib/harness/skills/baseline-skill";
import { verificationSkillV2 } from "../src/lib/harness/skills/verification-skill-v2";
import type { HarnessManifest } from "../src/lib/harness/types";

const MAX_EXPERIMENTS = 6;

const baseline: HarnessManifest = {
  ...baselineV1,
  id: "diagnosis4-baseline",
  name: "baseline-skill + full-context + baseline-prompt + maxTurns=8",
  skills: [baselineSkill],
  contextPolicy: "full",
};

const candidate: HarnessManifest = {
  ...baselineV1,
  id: "diagnosis4-candidate",
  name: "verification-skill-v2 + compact-context + concise-v2-prompt + maxTurns=9",
  skills: [verificationSkillV2],
  contextPolicy: "compact",
  // Benign distractor #1: a realistic-looking prompt tightening. Deliberately leaves the
  // read/file-access guidance sentence byte-for-byte identical to baselineV1's — an earlier
  // version of this distractor reworded that sentence ("read only the files you need") and,
  // per a live isolation test, that alone was enough to dodge the read-dedup/compaction trap
  // that causes the real skills x contextPolicy failure. This version only changes tone and
  // the closing summary format, which a live isolation run confirmed does not mask the failure.
  systemPrompt: [
    "You are a meticulous senior software engineer working inside a small, isolated Git repository.",
    "You can only interact with the repository through the provided tools.",
    "Read the relevant files first, then make the smallest correct change.",
    "Run the tests before you consider the task finished.",
    "When you are satisfied the task is complete, reply with exactly two sentences summarizing what changed and why, then stop calling tools.",
  ].join(" "),
  // Benign distractor #2: one more turn of budget, safe alone.
  execution: { maxTurns: 9 },
};

function pass(success: boolean): string {
  return success ? "PASS" : "FAIL";
}

function label(configuration: Record<string, string | undefined>): string {
  return Object.entries(configuration)
    .filter(([, v]) => v !== undefined)
    .map(([dim, level]) => `${dim}=${level}`)
    .join(", ");
}

async function main() {
  console.log("HarnessLab Adaptive Diagnosis (Milestone 6)\n");
  console.log(`Task: ${discountApplyTask.id}`);
  console.log(`Baseline: ${baseline.name}`);
  console.log(`Candidate: ${candidate.name}\n`);

  console.log("Planned live-call budget for this run:");
  console.log(`  up to ${2 + MAX_EXPERIMENTS} coding-agent calls (2 fixed: baseline + candidate; up to ${MAX_EXPERIMENTS} adaptive diagnostic experiments)`);
  console.log("  exactly 1 Nemotron mechanism-explanation call, once the classification is fixed\n");

  const diagnosis = await runDiagnosis({ task: discountApplyTask, baseline, candidate, maxExperiments: MAX_EXPERIMENTS });

  console.log(`Changed dimensions (${diagnosis.changedDimensions.length}):`);
  for (const dim of diagnosis.changedDimensions) console.log(`  - ${dim}`);
  console.log(`\nSearch space: ${diagnosis.exhaustiveConfigurations} theoretical configurations`);
  console.log(`Hypotheses supported by the model: ${diagnosis.hypothesisSpace.length} (${diagnosis.changedDimensions.length} main effects + ${diagnosis.hypothesisSpace.length - diagnosis.changedDimensions.length} pairwise interactions)\n`);

  console.log(`Baseline result: ${pass(diagnosis.baselineResult.success)}`);
  console.log(`Candidate result: ${pass(diagnosis.candidateResult.success)}\n`);

  if (!diagnosis.regressionDetected) {
    console.log("No regression detected in this live run.");
    console.log(`Reason: ${diagnosis.diagnosis.type === "inconclusive" ? diagnosis.diagnosis.reason : "unknown"}`);
    console.log("\nStopping before diagnosis — nothing was manufactured.");
    process.exit(0);
  }

  console.log("Regression detected.\n");
  console.log("Adaptive planner");
  console.log("─────────────────\n");
  diagnosis.experiments.forEach((experiment) => {
    console.log(`Experiment #${experiment.step} (bits=${experiment.bits})`);
    console.log(`Configuration: ${label(experiment.configuration)}`);
    console.log(`Information score: ${experiment.informationScore}`);
    console.log(`Why selected: ${experiment.whySelected}`);
    console.log(`Result: ${pass(experiment.result.success)}`);
    if (experiment.hypothesesRejected.length > 0) {
      console.log("Rejected:");
      for (const h of experiment.hypothesesRejected) console.log(`  ✕ ${h.id}`);
    }
    console.log(`Remaining hypotheses: ${experiment.hypothesesRemaining.map((h) => h.id).join(", ") || "(none)"}`);
    console.log("");
  });

  console.log("DIAGNOSIS");
  console.log("─────────\n");
  if (diagnosis.diagnosis.type === "interaction") {
    console.log(`INTERACTION DETECTED\n\n${diagnosis.diagnosis.factors.join(" x ")}`);
  } else if (diagnosis.diagnosis.type === "main_effect") {
    console.log(`MAIN EFFECT\n\n${diagnosis.diagnosis.factors.join(", ")}`);
  } else {
    console.log(`INCONCLUSIVE\n\n${diagnosis.diagnosis.reason}`);
  }

  console.log("\nEvidence:");
  for (const e of diagnosis.evidence) console.log(`  ${e.label} (${e.bits}): ${pass(e.success)}`);

  console.log("\nSearch efficiency:");
  console.log(`  Configurations executed: ${diagnosis.configurationsExecuted}/${diagnosis.exhaustiveConfigurations}`);
  console.log(`  Configurations avoided: ${diagnosis.configurationsAvoided}`);
  console.log(`  Search-space reduction: ${diagnosis.searchSpaceReductionPct}%`);
  console.log(`  Additional diagnostic experiments run: ${diagnosis.experimentsRun} (budget was ${MAX_EXPERIMENTS})`);

  if (diagnosis.fixedMechanismsObserved.length > 0) {
    console.log("\nFixed mechanisms observed (unchanged, but part of the failure):");
    for (const m of diagnosis.fixedMechanismsObserved) console.log(`  - ${m}`);
  }

  if (diagnosis.mechanismExplanation) {
    console.log("\nMechanism explanation (Nemotron, deterministic diagnosis above is unaffected by this):");
    console.log(diagnosis.mechanismExplanation);
  }

  const allTokens = [diagnosis.baselineResult, diagnosis.candidateResult, ...diagnosis.experiments.map((e) => e.result)];
  const totalInputTokens = allTokens.reduce((sum, r) => sum + (r.metrics.inputTokens ?? 0), 0);
  const totalOutputTokens = allTokens.reduce((sum, r) => sum + (r.metrics.outputTokens ?? 0), 0);
  const totalLatencyMs = allTokens.reduce((sum, r) => sum + r.metrics.latencyMs, 0);

  console.log("\nTokens & timing:");
  console.log(`  total input tokens: ${totalInputTokens}`);
  console.log(`  total output tokens: ${totalOutputTokens}`);
  console.log(`  total coding-agent latency: ${totalLatencyMs} ms`);
  console.log(`  shared setup time: ${diagnosis.environmentPreparationMs} ms`);

  console.log("\nSandbox:");
  console.log(`  shared base checkpoint: ${diagnosis.sharedBaseCheckpoint}`);

  console.log("\nEvidence file:");
  console.log(path.join(".harnesslab", "diagnoses", `${diagnosis.diagnosisId}.json`));

  process.exit(0);
}

main().catch((err) => {
  console.error("Diagnosis failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
