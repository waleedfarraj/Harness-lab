// Milestone 3 interaction experiment: runs the same coding task across all
// four cells of a 2x2 factorial (systemPrompt x execution.maxTurns) and
// computes the interaction contrast. Makes FOUR real Token Factory calls,
// one per cell. Run it deliberately, not in a loop.
import path from "node:path";
import { runFactorialExperiment, type FactorialCellOutcome } from "../src/lib/experiments/interaction";
import { paymentRetryTask } from "../src/lib/experiments/tasks/payment-retry";
import { baselineV1 } from "../src/lib/harness/manifests/baseline-v1";
import { candidateMinimalV1 } from "../src/lib/harness/manifests/candidate-minimal-v1";
import type { FactorDefinition } from "../src/lib/harness/factorial";

// Factor B's "constrained" value (7) is not an arbitrary cut: Milestone 2's
// real evidence showed the baseline prompt's trajectory completing (finishing
// message, no tool call) at turn 8, and the minimal prompt's at turn 7. Since
// the agent loop only reaches its natural "completed" stop if maxTurns is at
// least the turn on which the model stops requesting tools, maxTurns=7 is the
// exact boundary where the minimal prompt can still finish naturally but the
// baseline prompt (whose 7th turn was a tool call, not its finishing message)
// cannot. This is derived from measured turn counts, not guessed.
const SYSTEM_PROMPT_FACTOR: FactorDefinition<string> = {
  name: "systemPrompt",
  baselineValue: baselineV1.systemPrompt,
  candidateValue: candidateMinimalV1.systemPrompt,
};
const MAX_TURNS_FACTOR: FactorDefinition<number> = {
  name: "execution.maxTurns",
  baselineValue: 8, // normal — the value both Milestone 1 and 2 succeeded with
  candidateValue: 7, // constrained — see reasoning above
};

function pass(success: boolean): string {
  return success ? "PASS" : "FAIL";
}

function findCell(cells: FactorialCellOutcome[], promptLevel: "baseline" | "candidate", turnsLevel: "baseline" | "candidate"): FactorialCellOutcome {
  const cell = cells.find((c) => c.factors.systemPrompt === promptLevel && c.factors["execution.maxTurns"] === turnsLevel);
  if (!cell) throw new Error("missing expected factorial cell");
  return cell;
}

async function main() {
  console.log("HarnessLab Interaction Experiment\n");
  console.log(`Task: ${paymentRetryTask.id}\n`);
  console.log("Factors:");
  console.log("A: systemPrompt (baseline vs minimal)");
  console.log("B: execution.maxTurns (8 normal vs 7 constrained)\n");

  const interaction = await runFactorialExperiment({
    task: paymentRetryTask,
    factors: [SYSTEM_PROMPT_FACTOR, MAX_TURNS_FACTOR],
    baseManifest: baselineV1,
  });

  const cellA = findCell(interaction.cells, "baseline", "baseline"); // baseline prompt, normal turns
  const cellB = findCell(interaction.cells, "candidate", "baseline"); // minimal prompt, normal turns
  const cellC = findCell(interaction.cells, "baseline", "candidate"); // baseline prompt, constrained turns
  const cellD = findCell(interaction.cells, "candidate", "candidate"); // minimal prompt, constrained turns

  console.log("                          Normal turns    Constrained turns");
  console.log(`Baseline prompt           ${pass(cellA.result.success).padEnd(16)}${pass(cellC.result.success)}`);
  console.log(`Minimal prompt            ${pass(cellB.result.success).padEnd(16)}${pass(cellD.result.success)}\n`);

  console.log(`Interaction contrast: ${interaction.interactionContrast}`);
  console.log(`Interaction observed: ${interaction.interactionObserved ? "YES" : "NO"}\n`);

  console.log("Evidence:");
  for (const line of interaction.behaviorEvidence) console.log(`- ${line}`);
  console.log("- repository/task/model/evaluator were identical across all four cells (validated before any call)\n");

  console.log("Tokens:");
  for (const { cellId, result } of interaction.cells) {
    console.log(`  ${cellId}: input=${result.metrics.inputTokens ?? "?"} output=${result.metrics.outputTokens ?? "?"} total=${result.metrics.totalTokens ?? "?"}`);
  }
  console.log("\nLatency:");
  for (const { cellId, result } of interaction.cells) {
    console.log(`  ${cellId}: ${result.metrics.latencyMs} ms`);
  }

  console.log("\nEvidence file:");
  console.log(path.join(".harnesslab", "interactions", `${interaction.interactionId}.json`));

  process.exit(0);
}

main().catch((err) => {
  console.error("Interaction experiment failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
