// Cross-project demo: runs HarnessLab's stable diagnosis against an ApplyPilot-AI
// ranking task (fixtures/applypilot-rank, derived from ApplyPilot's
// services/job-dashboard/ranking.ts). Baseline = ApplyPilot's job-evaluation skill + full
// context; candidate = a plausible efficiency "optimization" (generic skill + compact
// context). Same model/prompt/maxTurns, so two dimensions change: skills x contextPolicy.
// Real coding-agent runs only (<= maxTotalRuns) plus 1 Nemotron explanation call.
// Run deliberately, not in a loop.
import path from "node:path";
import { runStableDiagnosis } from "../src/lib/diagnosis/diagnose-stable";
import { applypilotRankTask } from "../src/lib/experiments/tasks/applypilot-rank";
import { applypilotBaseline, applypilotCandidate } from "../src/lib/harness/manifests/applypilot-v1";
import type { ConfigurationAggregate, ReplicationPolicy } from "../src/lib/diagnosis/types";

const REPLICATION: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 10, reservedConfirmationRuns: 2 };

function outcomes(agg: ConfigurationAggregate): string {
  return agg.runs.map((r) => (r.success ? "PASS" : "FAIL")).join(" ");
}

async function main() {
  console.log("HarnessLab × ApplyPilot regression experiment\n");
  console.log(`Task: ${applypilotRankTask.id} — ${applypilotRankTask.title}`);
  console.log(`Baseline:  ${applypilotBaseline.name}`);
  console.log(`Candidate: ${applypilotCandidate.name}`);
  console.log(`Max live coding-agent runs: ${REPLICATION.maxTotalRuns} (+1 Nemotron explanation call)\n`);

  const d = await runStableDiagnosis({ task: applypilotRankTask, baseline: applypilotBaseline, candidate: applypilotCandidate, replication: REPLICATION });

  console.log(`Baseline  runs: ${outcomes(d.baselineAggregate)}  (failure rate ${(d.baselineAggregate.failureRate * 100).toFixed(0)}%)`);
  console.log(`Candidate runs: ${outcomes(d.candidateAggregate)}  (failure rate ${(d.candidateAggregate.failureRate * 100).toFixed(0)}%)`);
  console.log(`Changed dimensions: ${d.changedDimensions.join(", ")}\n`);

  if (!d.regressionDetected) {
    console.log("No regression detected in this live run — stopping, nothing was manufactured.");
    console.log(`Full evidence: ${path.join(".harnesslab", "diagnoses", `${d.diagnosisId}.json`)}`);
    process.exit(0);
  }

  console.log("ApplyPilot regression detected.\n");
  if (d.diagnosis.type === "interaction") console.log(`Diagnosis: INTERACTION ${d.diagnosis.factors.join(" x ")}`);
  else if (d.diagnosis.type === "main_effect") console.log(`Diagnosis: MAIN EFFECT ${d.diagnosis.factors.join(", ")}`);
  else console.log(`Diagnosis: INCONCLUSIVE — ${d.diagnosis.reason}`);
  console.log(`Evidence quality: ${d.stability.evidenceQuality.toUpperCase()} — ${d.stability.reason}`);
  console.log(`Total coding-agent runs: ${d.totalCodingRuns} (exploratory ${d.exploratoryRunCount}, confirmation ${d.confirmationRunCount})`);
  if (d.mechanismExplanation) console.log(`\nMechanism explanation (Nemotron):\n${d.mechanismExplanation}`);

  console.log(`\nFull evidence: ${path.join(".harnesslab", "diagnoses", `${d.diagnosisId}.json`)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("ApplyPilot experiment failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
