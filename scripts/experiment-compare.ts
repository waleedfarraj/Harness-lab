// Milestone 2 comparison: runs the same coding task under two explicit
// HarnessManifests (varying exactly one declared dimension) and prints a
// deterministic side-by-side comparison. Makes TWO real Token Factory calls
// (one per manifest). Run it deliberately, not in a loop.
import path from "node:path";
import { compareHarnesses } from "../src/lib/experiments/compare";
import { paymentRetryTask } from "../src/lib/experiments/tasks/payment-retry";
import { baselineV1 } from "../src/lib/harness/manifests/baseline-v1";
import { candidateMinimalV1 } from "../src/lib/harness/manifests/candidate-minimal-v1";
import type { ExperimentResult } from "../src/lib/experiments/types";

function row(label: string, baselineValue: string, candidateValue: string): string {
  return `${label.padEnd(25)}${baselineValue.padEnd(16)}${candidateValue}`;
}

function pass(flag: boolean): string {
  return flag ? "PASS" : "FAIL";
}

function tokenCell(result: ExperimentResult, key: "inputTokens" | "outputTokens" | "totalTokens"): string {
  const value = result.metrics[key];
  return value === undefined ? "unknown" : String(value);
}

async function main() {
  console.log("HarnessLab Comparison\n");
  console.log(`Task: ${paymentRetryTask.id}`);

  const comparison = await compareHarnesses({
    task: paymentRetryTask,
    baseline: baselineV1,
    candidate: candidateMinimalV1,
    expectedChangedDimensions: ["systemPrompt"],
  });

  console.log(`Changed dimension: ${comparison.changedDimensions.join(", ")}\n`);

  const { baseline, candidate } = comparison;
  console.log(row("", "Baseline", "Candidate"));
  console.log(row("Result", pass(baseline.success), pass(candidate.success)));
  console.log(row("Turns", String(baseline.metrics.agentTurns), String(candidate.metrics.agentTurns)));
  console.log(row("Tool calls", String(baseline.metrics.toolCalls), String(candidate.metrics.toolCalls)));
  console.log(row("Files changed", String(baseline.changedFiles.length), String(candidate.changedFiles.length)));
  console.log(row("Public tests", pass(baseline.evaluation.publicTestsPassed), pass(candidate.evaluation.publicTestsPassed)));
  console.log(row("Hidden tests", pass(baseline.evaluation.hiddenTestsPassed), pass(candidate.evaluation.hiddenTestsPassed)));
  console.log(
    row(
      "Relevant tests run",
      baseline.evaluation.relevantTestsExecuted ? "yes" : "no",
      candidate.evaluation.relevantTestsExecuted ? "yes" : "no",
    ),
  );
  console.log(row("Input tokens", tokenCell(baseline, "inputTokens"), tokenCell(candidate, "inputTokens")));
  console.log(row("Output tokens", tokenCell(baseline, "outputTokens"), tokenCell(candidate, "outputTokens")));
  console.log(row("Latency", `${baseline.metrics.latencyMs} ms`, `${candidate.metrics.latencyMs} ms`));

  console.log("\nBehavior differences:");
  if (comparison.delta.behaviorDifferences.length === 0) {
    console.log("- none detected");
  } else {
    for (const diff of comparison.delta.behaviorDifferences) console.log(`- ${diff}`);
  }

  console.log("\nComparison evidence:");
  console.log(path.join(".harnesslab", "comparisons", `${comparison.comparisonId}.json`));

  process.exit(baseline.success && candidate.success ? 0 : 1);
}

main().catch((err) => {
  console.error("Comparison failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
