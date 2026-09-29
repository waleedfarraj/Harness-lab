// Budget-aware stable diagnosis run: same task, same 4 changed harness
// dimensions (skills, contextPolicy, systemPrompt, execution.maxTurns), same
// shared Nebius Sandbox checkpoint approach as Milestone 7. Uses Milestone 9's
// default planner (src/lib/diagnosis/stable-planner.ts's `selectNextAction`):
// every diagnostic configuration gets exactly ONE exploratory run first (not
// immediate replication to minRuns); a reserved confirmation budget is held
// back for confirming decision-critical configurations; and exploration
// ranking additionally weighs separator rarity (see stability.ts's
// `computeSeparatorRarity`) and a bounded look-ahead against leaving a
// surviving hypothesis pair with no budget left to resolve it — see
// stable-planner.ts's doc comment for the exact priority order.
//
// Hard budget: maxTotalRuns=10 real coding-agent executions total (baseline
// + candidate + every exploratory/confirmation run), plus exactly 1 real
// Nemotron explanation call once the classification is fixed. Run it
// deliberately, not in a loop; do not auto-retry on a surprising result.
import path from "node:path";
import { runStableDiagnosis } from "../src/lib/diagnosis/diagnose-stable";
import { formatDiagnosisAgreement, summarizeDiagnosisAgreement } from "../src/lib/diagnosis/compare-runs";
import { discountApplyTask } from "../src/lib/experiments/tasks/discount-apply";
import { baselineV1 } from "../src/lib/harness/manifests/baseline-v1";
import { baselineSkill } from "../src/lib/harness/skills/baseline-skill";
import { verificationSkillV2 } from "../src/lib/harness/skills/verification-skill-v2";
import type { HarnessManifest } from "../src/lib/harness/types";
import type { ConfigurationAggregate, ReplicationPolicy } from "../src/lib/diagnosis/types";

const REPLICATION: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 10, reservedConfirmationRuns: 2 };

const baseline: HarnessManifest = {
  ...baselineV1,
  id: "diagnosis-stable-baseline",
  name: "baseline-skill + full-context + baseline-prompt + maxTurns=8",
  skills: [baselineSkill],
  contextPolicy: "full",
};

const candidate: HarnessManifest = {
  ...baselineV1,
  id: "diagnosis-stable-candidate",
  name: "verification-skill-v2 + compact-context + tone-only-prompt + maxTurns=9",
  skills: [verificationSkillV2],
  contextPolicy: "compact",
  // Same verified-benign distractor as Milestone 7's corrected version: tone/closing-format only,
  // the read/file-access guidance sentence is byte-for-byte identical to baselineV1's.
  systemPrompt: [
    "You are a meticulous senior software engineer working inside a small, isolated Git repository.",
    "You can only interact with the repository through the provided tools.",
    "Read the relevant files first, then make the smallest correct change.",
    "Run the tests before you consider the task finished.",
    "When you are satisfied the task is complete, reply with exactly two sentences summarizing what changed and why, then stop calling tools.",
  ].join(" "),
  execution: { maxTurns: 9 },
};

function outcomes(agg: ConfigurationAggregate): string {
  return agg.runs.map((r) => (r.success ? "PASS" : "FAIL")).join(" ");
}

function printAggregate(agg: ConfigurationAggregate) {
  console.log(`${agg.configurationVector} ${agg.label}`);
  console.log(outcomes(agg));
  console.log(`failure rate: ${(agg.failureRate * 100).toFixed(1)}%  (stability: ${agg.stability})`);
  console.log("");
}

async function main() {
  console.log("HarnessLab Stable Diagnosis (Milestone 9 planner)\n");
  console.log(`Task: ${discountApplyTask.id}`);
  console.log(`Baseline: ${baseline.name}`);
  console.log(`Candidate: ${candidate.name}\n`);

  console.log("Replication policy:");
  console.log(`  minRunsPerConfiguration = ${REPLICATION.minRunsPerConfiguration}`);
  console.log(`  maxRunsPerConfiguration = ${REPLICATION.maxRunsPerConfiguration}`);
  console.log(`  maxTotalRuns = ${REPLICATION.maxTotalRuns} (hard cap, includes baseline/candidate/exploration/confirmation)`);
  console.log(`  reservedConfirmationRuns = ${REPLICATION.reservedConfirmationRuns} (never spent on plain exploration)\n`);
  console.log(`Maximum possible live coding-agent runs this call could make: ${REPLICATION.maxTotalRuns}`);
  console.log("Plus exactly 1 Nemotron mechanism-explanation call, once the classification is fixed.\n");

  const diagnosis = await runStableDiagnosis({ task: discountApplyTask, baseline, candidate, replication: REPLICATION });

  console.log(`Changed dimensions: ${diagnosis.changedDimensions.length}`);
  console.log(`Search space: ${diagnosis.exhaustiveConfigurations}`);
  console.log(`Run budget: ${diagnosis.replicationPolicy.maxTotalRuns}\n`);
  console.log("────────────────\n");

  printAggregate(diagnosis.baselineAggregate);
  printAggregate(diagnosis.candidateAggregate);

  if (!diagnosis.regressionDetected) {
    console.log("No regression detected in this live run.");
    console.log(`Reason: ${diagnosis.diagnosis.type === "inconclusive" ? diagnosis.diagnosis.reason : "unknown"}`);
    console.log("\nStopping before diagnosis — nothing was manufactured.");
    process.exit(0);
  }

  console.log("Regression detected.\n");
  console.log("Planner:");
  console.log("────────────────\n");
  diagnosis.steps.forEach((s) => {
    console.log(`${s.action === "explore" ? "Exploring" : "Confirming"} ${s.bits} (run ${s.aggregateAfter.runs.length}, budget remaining before this run: ${s.remainingRunBudget}, reserved: ${s.reservedConfirmationRuns})`);
    console.log(`result: ${s.runResult.success ? "PASS" : "FAIL"}`);
    console.log(`Why: ${s.whySelected}`);
    console.log(`evidence maturity: ${s.aggregateAfter.evidenceMaturity}  failure rate: ${(s.aggregateAfter.failureRate * 100).toFixed(1)}%  decisionCriticality: ${s.decisionCriticality}`);
    if (s.hypothesesRejected.length > 0) {
      console.log("Confirmed-rejected:");
      for (const h of s.hypothesesRejected) console.log(`  ✕ ${h.id}`);
    }
    console.log(`Provisional leading hypotheses: ${s.provisionalHypothesesAfter.filter((h) => h.status !== "rejected").map((h) => h.id).join(", ") || "(none)"}`);
    console.log("");
  });

  console.log("FINAL DIAGNOSIS");
  console.log("────────────────\n");
  if (diagnosis.diagnosis.type === "interaction") {
    console.log(`INTERACTION\n\n${diagnosis.diagnosis.factors.join(" x ")}`);
  } else if (diagnosis.diagnosis.type === "main_effect") {
    console.log(`MAIN EFFECT\n\n${diagnosis.diagnosis.factors.join(", ")}`);
  } else {
    console.log(`INCONCLUSIVE\n\n${diagnosis.diagnosis.reason}`);
  }

  console.log(`\nEvidence quality: ${diagnosis.stability.evidenceQuality.toUpperCase()}`);
  console.log(diagnosis.stability.reason);
  if (diagnosis.stability.unstableConfigurations.length > 0) {
    console.log(`Unstable configurations: ${diagnosis.stability.unstableConfigurations.join(", ")}`);
  } else {
    console.log("Alternative remaining: none");
  }

  console.log(`\nTotal coding-agent runs: ${diagnosis.totalCodingRuns}`);
  console.log(`Exploratory runs: ${diagnosis.exploratoryRunCount}`);
  console.log(`Confirmation runs: ${diagnosis.confirmationRunCount}`);
  console.log(`Search configurations visited: ${diagnosis.configurationsVisited} / ${diagnosis.exhaustiveConfigurations}`);
  console.log(`Configurations avoided: ${diagnosis.configurationsAvoided}`);
  console.log(`Search-space reduction: ${diagnosis.searchSpaceReductionPct}%`);

  const allRuns = diagnosis.aggregates.flatMap((a) => a.runs);
  const totalInputTokens = allRuns.reduce((sum, r) => sum + (r.metrics.inputTokens ?? 0), 0);
  const totalOutputTokens = allRuns.reduce((sum, r) => sum + (r.metrics.outputTokens ?? 0), 0);
  const totalLatencyMs = allRuns.reduce((sum, r) => sum + r.metrics.latencyMs, 0);
  console.log(`\nTotal input tokens: ${totalInputTokens}`);
  console.log(`Total output tokens: ${totalOutputTokens}`);
  console.log(`Total coding-agent latency: ${totalLatencyMs} ms`);
  console.log(`Shared setup time: ${diagnosis.environmentPreparationMs} ms`);

  if (diagnosis.fixedMechanismsObserved.length > 0) {
    console.log("\nFixed mechanisms observed (unchanged, but part of the failure):");
    for (const m of diagnosis.fixedMechanismsObserved) console.log(`  - ${m}`);
  }

  if (diagnosis.mechanismExplanation) {
    console.log("\nMechanism explanation (Nemotron, deterministic diagnosis above is unaffected by this):");
    console.log(diagnosis.mechanismExplanation);
  }

  console.log("\nSandbox:");
  console.log(`  shared base checkpoint: ${diagnosis.sharedBaseCheckpoint}`);

  console.log("\nComparison with previous diagnosis ATTEMPTS for this task (each attempt may itself contain many coding-agent runs — this is not a coding-run count):");
  console.log(formatDiagnosisAgreement(summarizeDiagnosisAgreement(discountApplyTask.id)));

  console.log("\nFull evidence:");
  console.log(path.join(".harnesslab", "diagnoses", `${diagnosis.diagnosisId}.json`));

  process.exit(0);
}

main().catch((err) => {
  console.error("Stable diagnosis failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
