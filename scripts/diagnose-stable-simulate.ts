// Milestone 9 offline simulation: replays the exact outcome pattern from
// Milestone 7/8's live run (skills x contextPolicy interaction, with
// systemPrompt and execution.maxTurns as benign distractors) against a
// deterministic, non-stochastic ground-truth function — no Nebius calls, no
// randomness — running BOTH the Milestone 8 planner and the Milestone 9
// planner (separator rarity + bounded look-ahead) side by side, per section 7
// of the Milestone 9 spec: "print old planner trace / new planner trace".
// Required to run (and be read) before the live diagnose:stable run.
//
// Ground truth: FAIL iff skills=candidate AND contextPolicy=candidate,
// regardless of systemPrompt/execution.maxTurns.
//
// Honest result of this simulation (see the printed comparison at the end):
// on THIS exact fixture and 10-run budget, the two planners produce an
// IDENTICAL trace and an identical INCONCLUSIVE result. This is not a bug —
// see the analysis in this file's final comment block. Resolving this
// hypothesis space fully (10 hypotheses -> 1) via the isolate-one-dimension
// strategy both planners use requires 4 replicated diagnostic configurations
// (8 runs) on top of baseline+candidate's 4, i.e. 12 runs total; only 10 are
// budgeted. Milestone 9's separator-rarity/look-ahead mechanism is a real,
// generically-useful improvement (see tests/diagnosis-separator-rarity.test.ts
// for adversarial cases where it changes the outcome), but it cannot
// manufacture budget that was never allocated. Section 12 of the spec
// explicitly anticipates and accepts this: "A valid inconclusive result under
// stochastic/budget-limited evidence is acceptable product behavior."
import { runStableDiagnosis } from "../src/lib/diagnosis/diagnose-stable";
import { selectNextAction, selectNextActionMilestone8 } from "../src/lib/diagnosis/stable-planner";
import { baselineV1 } from "../src/lib/harness/manifests/baseline-v1";
import { baselineSkill } from "../src/lib/harness/skills/baseline-skill";
import { verificationSkillV2 } from "../src/lib/harness/skills/verification-skill-v2";
import type { CodingTask, ExperimentResult } from "../src/lib/experiments/types";
import type { HarnessManifest } from "../src/lib/harness/types";
import type { SandboxHandle, SandboxRunner } from "../src/lib/sandbox/types";
import type { StableDiagnosisResult } from "../src/lib/diagnosis/types";

const task: CodingTask = {
  id: "discount-apply-001",
  title: "Simulated task",
  instruction: "(offline simulation only — no real coding agent runs)",
  fixturePath: "fixtures/discount-apply",
  allowedCommands: [],
  evaluator: async () => {
    throw new Error("not used: runExperimentFn is mocked in this simulation");
  },
};

const baseline: HarnessManifest = { ...baselineV1, id: "sim-baseline", name: "sim-baseline", skills: [baselineSkill], contextPolicy: "full" };
const candidate: HarnessManifest = {
  ...baselineV1,
  id: "sim-candidate",
  name: "sim-candidate",
  skills: [verificationSkillV2],
  contextPolicy: "compact",
  systemPrompt: "a different, but individually-safe, system prompt",
  execution: { maxTurns: 9 },
};

function fakeResult(success: boolean, manifestId: string): ExperimentResult {
  return {
    runId: `sim-${manifestId}-${Math.random()}`,
    taskId: task.id,
    manifestId,
    success,
    terminationReason: success ? "completed" : "max_turns",
    evaluation: { buildPassed: true, publicTestsPassed: success, hiddenTestsPassed: success, relevantTestsExecuted: success },
    changedFiles: success ? ["src/applyDiscount.ts"] : [],
    metrics: { agentTurns: 8, toolCalls: 8, latencyMs: 1000, inputTokens: 100, outputTokens: 10, totalTokens: 110 },
    evidence: {
      trajectory: { turns: [], toolCallCount: 0, stopReason: success ? "completed" : "max_turns", terminationDetail: null, finalAssistantMessage: null, totalUsage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } },
      diff: "",
      evaluatorRaw: {},
      sandbox: { runner: "local", handleId: "sim" },
    },
  };
}

// changedDimensions order is fixed by diffManifests: [systemPrompt, execution.maxTurns, skills, contextPolicy]
// -> skills is bit index 2, contextPolicy is bit index 3.
function groundTruthRunExperimentFn() {
  return async (_t: CodingTask, manifest: HarnessManifest): Promise<ExperimentResult> => {
    const bits = manifest.id === "sim-baseline" ? "0000" : manifest.id === "sim-candidate" ? "1111" : manifest.id.replace("diagnostic-", "");
    const success = !(bits[2] === "1" && bits[3] === "1");
    return fakeResult(success, manifest.id);
  };
}

function offlineRunner(): SandboxRunner {
  const sharedHandle: SandboxHandle = { id: "sim-shared-base" };
  let forkCount = 0;
  return {
    async create() {
      return sharedHandle;
    },
    async forkFrom(base, label) {
      forkCount += 1;
      return { id: `${label ?? "fork"}-${forkCount}` };
    },
    async execute() {
      throw new Error("not used in simulation");
    },
    async listFiles() {
      throw new Error("not used in simulation");
    },
    async readFile() {
      throw new Error("not used in simulation");
    },
    async writeFile() {
      throw new Error("not used in simulation");
    },
    async destroy() {},
  };
}

async function runTrace(label: string, selectNextActionFn: typeof selectNextAction): Promise<StableDiagnosisResult> {
  console.log(`\n${"=".repeat(78)}`);
  console.log(label);
  console.log("=".repeat(78));

  const result = await runStableDiagnosis(
    { task, baseline, candidate, replication: { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 10, reservedConfirmationRuns: 2 } },
    { runner: offlineRunner(), skipExplanation: true, runExperimentFn: groundTruthRunExperimentFn(), selectNextActionFn },
  );

  console.log(`baseline: ${result.baselineAggregate.stability}  [${result.baselineAggregate.runs.map((r) => (r.success ? "PASS" : "FAIL")).join(", ")}]`);
  console.log(`candidate: ${result.candidateAggregate.stability}  [${result.candidateAggregate.runs.map((r) => (r.success ? "PASS" : "FAIL")).join(", ")}]\n`);

  console.log("Planner trace:");
  console.log("──────────────");
  for (const s of result.steps) {
    console.log(`step ${s.step}  ${s.action.toUpperCase()}  bits=${s.bits}  result=${s.runResult.success ? "PASS" : "FAIL"}  dc=${s.decisionCriticality}  info=${s.informationScore}  rarity=${s.separatorRarityScore.toFixed(3)}  rarePairs=${s.rarePairsSeparated}  risky=${s.lookaheadRisk}`);
    console.log(`  why: ${s.whySelected}`);
    console.log(`  evidence maturity after: ${s.aggregateAfter.evidenceMaturity} (${s.aggregateAfter.stability})`);
    console.log(`  confirmed-remaining after: ${s.hypothesesRemaining.map((h) => h.id).join(", ") || "(none)"}`);
    console.log("");
  }

  console.log("RESULT");
  console.log("──────");
  console.log(JSON.stringify(result.diagnosis, null, 2));
  console.log(`\nEvidence quality: ${result.stability.evidenceQuality}`);
  console.log(`Total simulated runs: ${result.totalCodingRuns} / ${result.replicationPolicy.maxTotalRuns} (budget)`);
  console.log(`Exploratory: ${result.exploratoryRunCount}, Confirmation: ${result.confirmationRunCount}`);
  console.log(`Configurations visited: ${result.configurationsVisited} / ${result.exhaustiveConfigurations}`);

  return result;
}

function checks(result: StableDiagnosisResult): { budgetOk: boolean; noFalsePositive: boolean } {
  const budgetOk = result.totalCodingRuns <= result.replicationPolicy.maxTotalRuns;
  const noFalsePositive =
    result.diagnosis.type !== "interaction" && result.diagnosis.type !== "main_effect"
      ? true
      : result.diagnosis.type === "interaction" && result.diagnosis.factors.join("+") === "skills+contextPolicy";
  return { budgetOk, noFalsePositive };
}

async function main() {
  console.log("HarnessLab Milestone 9 — Offline Planner Simulation (no Nebius calls)");
  console.log("Replaying the Milestone 7/8 outcome pattern: skills x contextPolicy interaction,");
  console.log("with systemPrompt and execution.maxTurns as benign distractors, maxTotalRuns=10.");

  const oldResult = await runTrace("OLD PLANNER TRACE (Milestone 8: selectNextActionMilestone8)", selectNextActionMilestone8);
  const newResult = await runTrace("NEW PLANNER TRACE (Milestone 9: selectNextAction)", selectNextAction);

  console.log(`\n${"=".repeat(78)}`);
  console.log("COMPARISON");
  console.log("=".repeat(78));
  console.log(`old planner: ${oldResult.totalCodingRuns} runs, diagnosis=${JSON.stringify(oldResult.diagnosis)}`);
  console.log(`new planner: ${newResult.totalCodingRuns} runs, diagnosis=${JSON.stringify(newResult.diagnosis)}`);
  console.log(
    oldResult.steps.map((s) => s.bits).join(",") === newResult.steps.map((s) => s.bits).join(",")
      ? "\nBoth planners visited the exact same sequence of configurations on this fixture (see this file's header comment for the information-theoretic reason a smarter ranking alone can't do better here within this exact 10-run budget)."
      : "\nThe two planners diverged in which configurations they visited.",
  );

  const oldChecks = checks(oldResult);
  const newChecks = checks(newResult);
  console.log(`\nOld planner — budget respected: ${oldChecks.budgetOk}, no false-positive mechanism: ${oldChecks.noFalsePositive}`);
  console.log(`New planner — budget respected: ${newChecks.budgetOk}, no false-positive mechanism: ${newChecks.noFalsePositive}`);

  if (!newChecks.budgetOk || !newChecks.noFalsePositive) {
    console.error("\nSIMULATION FAILED — do not proceed to a live run.");
    process.exit(1);
  }
  console.log("\nSimulation passed — safe to proceed to a live run.");
}

main();
