// Milestone 5 diagnosis smoke run: given only a baseline harness, a
// candidate harness, and a task, HarnessLab confirms the regression,
// automatically discovers which dimensions changed, plans and runs the
// minimum diagnostic experiments needed, and (once the classification is
// fixed) asks Nemotron once for a mechanism explanation. Makes up to 4 real
// coding-agent calls plus one real explanation call. Run it deliberately,
// not in a loop.
import path from "node:path";
import { runDiagnosis } from "../src/lib/diagnosis/diagnose";
import { discountApplyTask } from "../src/lib/experiments/tasks/discount-apply";
import { baselineV1 } from "../src/lib/harness/manifests/baseline-v1";
import { baselineSkill } from "../src/lib/harness/skills/baseline-skill";
import { verificationSkillV2 } from "../src/lib/harness/skills/verification-skill-v2";
import type { HarnessManifest } from "../src/lib/harness/types";

const baseline: HarnessManifest = {
  ...baselineV1,
  id: "diagnosis-baseline",
  name: "baseline-skill + full-context",
  skills: [baselineSkill],
  contextPolicy: "full",
};
const candidate: HarnessManifest = {
  ...baselineV1,
  id: "diagnosis-candidate",
  name: "verification-skill-v2 + compact-context",
  skills: [verificationSkillV2],
  contextPolicy: "compact",
};

function pass(success: boolean): string {
  return success ? "PASS" : "FAIL";
}

async function main() {
  console.log("HarnessLab Diagnosis\n");
  console.log(`Task:\n${discountApplyTask.id}\n`);
  console.log(`Baseline:\n${baseline.name}`);
  console.log(`Candidate:\n${candidate.name}\n`);

  const diagnosis = await runDiagnosis({ task: discountApplyTask, baseline, candidate, maxExperiments: 2 });

  console.log(`Baseline result: ${pass(diagnosis.baselineResult.success)}`);
  console.log(`Candidate result: ${pass(diagnosis.candidateResult.success)}\n`);

  if (!diagnosis.regressionDetected) {
    console.log("No regression detected in this live run.");
    console.log(`Reason: ${diagnosis.diagnosis.type === "inconclusive" ? diagnosis.diagnosis.reason : "unknown"}`);
    console.log("\nStopping before diagnosis — nothing was manufactured.");
    process.exit(0);
  }

  console.log("Regression detected.\n");
  console.log("Changed dimensions:");
  for (const dim of diagnosis.changedDimensions) console.log(`  - ${dim}`);

  console.log("\nExperiment planner");
  console.log("──────────────────\n");
  diagnosis.experiments.forEach((experiment, i) => {
    console.log(`Experiment #${i + 1}`);
    console.log(Object.entries(experiment.configuration).map(([dim, level]) => `${dim}=${level}`).join(", "));
    console.log(`\nWhy:\n${experiment.whySelected}`);
    console.log(`\nResult:\n${pass(experiment.result.success)}`);
    const rejected = experiment.hypothesesAfter.filter((h) => h.status === "rejected" && !experiment.hypothesesBefore.find((b) => b.id === h.id && b.status === "rejected"));
    if (rejected.length > 0) {
      console.log("\nRejected:");
      for (const h of rejected) console.log(`  ✕ ${h.id}`);
    }
    console.log("");
  });

  console.log("Diagnosis");
  console.log("─────────\n");
  if (diagnosis.diagnosis.type === "interaction") {
    console.log(`INTERACTION DETECTED\n\n${diagnosis.diagnosis.factors.join(" x ")}`);
  } else if (diagnosis.diagnosis.type === "main_effect") {
    console.log(`MAIN EFFECT\n\n${diagnosis.diagnosis.factors.join(", ")}`);
  } else {
    console.log(`INCONCLUSIVE\n\n${diagnosis.diagnosis.reason}`);
  }

  console.log("\nEvidence:");
  for (const e of diagnosis.evidence) console.log(`  ${e.label}: ${pass(e.success)}`);

  console.log(`\nExperiments selected automatically: ${diagnosis.experimentsRun}`);
  console.log(`Candidate diagnostic configurations: ${diagnosis.experimentsRun}`);
  console.log(`Exhaustive harness configurations: ${diagnosis.exhaustiveConfigurations}`);

  if (diagnosis.fixedMechanismsObserved.length > 0) {
    console.log("\nFixed mechanisms observed (unchanged, but part of the failure):");
    for (const m of diagnosis.fixedMechanismsObserved) console.log(`  - ${m}`);
  }

  if (diagnosis.mechanismExplanation) {
    console.log("\nMechanism:");
    console.log(diagnosis.mechanismExplanation);
  }

  console.log("\nSandbox:");
  console.log(`  shared base checkpoint: ${diagnosis.sharedBaseCheckpoint}`);
  console.log(`  environment preparation: ${diagnosis.environmentPreparationMs} ms`);

  console.log("\nEvidence file:");
  console.log(path.join(".harnesslab", "diagnoses", `${diagnosis.diagnosisId}.json`));

  process.exit(0);
}

main().catch((err) => {
  console.error("Diagnosis failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
