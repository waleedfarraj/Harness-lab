// Milestone 1 smoke experiment: gives Nemotron Super one real coding task
// against the payment-retry fixture, evaluates it deterministically, and
// prints a concise summary. Full evidence is written to .harnesslab/runs/.
//
// This makes a REAL Token Factory call. Run it deliberately, not in a loop.
import path from "node:path";
import { baselineV1 } from "../src/lib/harness/manifests/baseline-v1";
import { runExperiment } from "../src/lib/experiments/run-experiment";
import { paymentRetryTask } from "../src/lib/experiments/tasks/payment-retry";

async function main() {
  console.log("HarnessLab Experiment\n");
  console.log(`Task: ${paymentRetryTask.id}`);

  const result = await runExperiment(paymentRetryTask, baselineV1);
  const model = result.evidence.trajectory.turns[0]?.model ?? "unknown";

  console.log(`Model: ${model}\n`);
  console.log(`Agent turns: ${result.metrics.agentTurns}`);
  console.log(`Tool calls: ${result.metrics.toolCalls}`);
  console.log(`Files changed: ${result.changedFiles.length}`);
  console.log(`Relevant tests executed: ${result.evaluation.relevantTestsExecuted ? "yes" : "no"}\n`);
  console.log(`Public tests: ${result.evaluation.publicTestsPassed ? "PASS" : "FAIL"}`);
  console.log(`Hidden tests: ${result.evaluation.hiddenTestsPassed ? "PASS" : "FAIL"}`);
  console.log(`Build: ${result.evaluation.buildPassed ? "PASS" : "FAIL"}\n`);
  console.log(`Result: ${result.success ? "PASS" : "FAIL"}\n`);
  console.log(`Input tokens: ${result.metrics.inputTokens ?? "unknown"}`);
  console.log(`Output tokens: ${result.metrics.outputTokens ?? "unknown"}`);
  console.log(`Total tokens: ${result.metrics.totalTokens ?? "unknown"}`);
  console.log(`Latency: ${result.metrics.latencyMs} ms`);
  console.log(`Run evidence: ${path.join(".harnesslab", "runs", `${result.runId}.json`)}`);

  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error("Experiment failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
