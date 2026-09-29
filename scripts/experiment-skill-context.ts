// Milestone 4 interaction experiment: runs the discount-apply task across
// all four cells of a 2x2 factorial (skills x contextPolicy), forking all
// four cells from ONE shared Sandbox base checkpoint. Makes FOUR real
// coding-agent calls (one per cell) plus one shared-setup call. Run it
// deliberately, not in a loop.
import path from "node:path";
import { runFactorialExperiment, type FactorialCellOutcome } from "../src/lib/experiments/interaction";
import { discountApplyTask } from "../src/lib/experiments/tasks/discount-apply";
import { baselineV1 } from "../src/lib/harness/manifests/baseline-v1";
import { baselineSkill } from "../src/lib/harness/skills/baseline-skill";
import { verificationSkillV2 } from "../src/lib/harness/skills/verification-skill-v2";
import type { FactorDefinition } from "../src/lib/harness/factorial";
import type { ContextPolicy, Skill } from "../src/lib/harness/types";

const SKILL_FACTOR: FactorDefinition<Skill[]> = {
  name: "skills",
  baselineValue: [baselineSkill],
  candidateValue: [verificationSkillV2],
};
const CONTEXT_FACTOR: FactorDefinition<ContextPolicy> = {
  name: "contextPolicy",
  baselineValue: "full",
  candidateValue: "compact",
};

const LABELS = {
  A: "baseline-skill + full-context",
  B: "verification-skill-v2 + full-context",
  C: "baseline-skill + compact-context",
  D: "verification-skill-v2 + compact-context",
} as const;

function pass(success: boolean): string {
  return success ? "PASS" : "FAIL";
}

function findCell(cells: FactorialCellOutcome[], skillLevel: "baseline" | "candidate", contextLevel: "baseline" | "candidate"): FactorialCellOutcome {
  const cell = cells.find((c) => c.factors.skills === skillLevel && c.factors.contextPolicy === contextLevel);
  if (!cell) throw new Error("missing expected factorial cell");
  return cell;
}

async function main() {
  console.log("HarnessLab Skill x Context Interaction Experiment\n");
  console.log(`Task: ${discountApplyTask.id}\n`);
  console.log("Factors:");
  console.log("A: skills (baseline-skill vs verification-skill-v2)");
  console.log("B: contextPolicy (full vs compact)\n");
  console.log("Preparing shared base Sandbox checkpoint...");

  const interaction = await runFactorialExperiment({
    task: discountApplyTask,
    factors: [SKILL_FACTOR, CONTEXT_FACTOR],
    baseManifest: baselineV1,
    sharedCheckpoint: true,
    sharedCheckpointLabel: `${discountApplyTask.id}-shared-base`,
    cellLabels: LABELS,
  });

  const cellA = findCell(interaction.cells, "baseline", "baseline");
  const cellB = findCell(interaction.cells, "candidate", "baseline");
  const cellC = findCell(interaction.cells, "baseline", "candidate");
  const cellD = findCell(interaction.cells, "candidate", "candidate");

  console.log(`\nShared base checkpoint: ${interaction.sharedBaseCheckpoint}`);
  console.log(`Environment preparation: ${interaction.environmentPreparationMs} ms`);
  console.log(`Fork times: ${interaction.forkTimingsMs.join(", ")} ms\n`);

  console.log("                          Full context      Compact context");
  console.log(`Baseline skill            ${pass(cellA.result.success).padEnd(18)}${pass(cellC.result.success)}`);
  console.log(`Verification skill v2     ${pass(cellB.result.success).padEnd(18)}${pass(cellD.result.success)}\n`);

  console.log(`Interaction contrast: ${interaction.interactionContrast}`);
  console.log(`Interaction observed: ${interaction.interactionObserved ? "YES" : "NO"}\n`);

  console.log("Evidence:");
  for (const line of interaction.behaviorEvidence) console.log(`- ${line}`);
  console.log("- repository/task/model/system prompt/evaluator were identical across all four cells (validated before any call)");
  console.log("- all four cells forked from the same shared base checkpoint\n");

  console.log("Cells:");
  for (const { cellId, result } of interaction.cells) {
    console.log(
      `  ${cellId}: ${pass(result.success)} term=${result.terminationReason} turns=${result.metrics.agentTurns} toolCalls=${result.metrics.toolCalls} ` +
        `build=${result.evaluation.buildPassed} public=${result.evaluation.publicTestsPassed} hidden=${result.evaluation.hiddenTestsPassed} ` +
        `in=${result.metrics.inputTokens} out=${result.metrics.outputTokens} latency=${result.metrics.latencyMs}ms`,
    );
  }

  console.log("\nEvidence file:");
  console.log(path.join(".harnesslab", "interactions", `${interaction.interactionId}.json`));

  process.exit(0);
}

main().catch((err) => {
  console.error("Interaction experiment failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
