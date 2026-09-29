import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { computeStability, runStableDiagnosis } from "../src/lib/diagnosis/diagnose-stable";
import { baselineV1 } from "../src/lib/harness/manifests/baseline-v1";
import { baselineSkill } from "../src/lib/harness/skills/baseline-skill";
import { verificationSkillV2 } from "../src/lib/harness/skills/verification-skill-v2";
import type { CodingTask, ExperimentResult } from "../src/lib/experiments/types";
import type { ConfigurationAggregate, ReplicationPolicy } from "../src/lib/diagnosis/types";
import type { HarnessManifest } from "../src/lib/harness/types";
import type { SandboxHandle, SandboxRunner } from "../src/lib/sandbox/types";

function diagnosisEvidencePath(diagnosisId: string): string {
  return path.join(process.cwd(), ".harnesslab", "diagnoses", `${diagnosisId}.json`);
}

const task: CodingTask = {
  id: "fake-stable-task",
  title: "Fake task",
  instruction: "do the thing",
  fixturePath: "fixtures/does-not-matter",
  allowedCommands: ["npm test"],
  evaluator: async () => {
    throw new Error("not used: runExperimentFn is mocked in these tests");
  },
};

const baseline: HarnessManifest = { ...baselineV1, id: "diag-baseline", name: "diag-baseline", skills: [baselineSkill], contextPolicy: "full" };
const candidate: HarnessManifest = { ...baselineV1, id: "diag-candidate", name: "diag-candidate", skills: [verificationSkillV2], contextPolicy: "compact" };

const POLICY: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 20, reservedConfirmationRuns: 2 };

function fakeResult(success: boolean, manifestId: string): ExperimentResult {
  return {
    runId: `run-${manifestId}-${Math.random()}`,
    taskId: task.id,
    manifestId,
    success,
    terminationReason: success ? "completed" : "max_turns",
    evaluation: { buildPassed: true, publicTestsPassed: success, hiddenTestsPassed: success, relevantTestsExecuted: success },
    changedFiles: success ? ["src/a.ts"] : [],
    metrics: { agentTurns: 8, toolCalls: 8, latencyMs: 1000, inputTokens: 100, outputTokens: 10, totalTokens: 110 },
    evidence: {
      trajectory: { turns: [], toolCallCount: 0, stopReason: success ? "completed" : "max_turns", terminationDetail: null, finalAssistantMessage: null, totalUsage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } },
      diff: "",
      evaluatorRaw: {},
      sandbox: { runner: "token-factory", handleId: "h" },
    },
  };
}

/** Scripts a fixed outcome sequence per manifest id; once a script is exhausted, repeats its last entry. */
function scriptedRunExperimentFn(scripts: Record<string, boolean[]>) {
  const callCounts = new Map<string, number>();
  return async (_task: CodingTask, manifest: HarnessManifest): Promise<ExperimentResult> => {
    const script = scripts[manifest.id] ?? [true];
    const n = callCounts.get(manifest.id) ?? 0;
    callCounts.set(manifest.id, n + 1);
    const outcome = script[Math.min(n, script.length - 1)];
    return fakeResult(outcome, manifest.id);
  };
}

function fakeRunner(): { runner: SandboxRunner; createCalls: { count: number }; forkCalls: { label: string; baseId: string }[]; destroyed: string[] } {
  const createCalls = { count: 0 };
  const forkCalls: { label: string; baseId: string }[] = [];
  const destroyed: string[] = [];
  const sharedHandle: SandboxHandle = { id: "shared-base", checkpoint: "chk-shared-base" };
  const runner: SandboxRunner = {
    async create() {
      createCalls.count += 1;
      return sharedHandle;
    },
    async forkFrom(base: SandboxHandle, label?: string) {
      forkCalls.push({ label: label ?? "?", baseId: base.id });
      assert.equal(base.id, sharedHandle.id, "every fork must start from the one shared checkpoint, never from a prior replicate's result");
      return { id: `${label}-fork-${forkCalls.length}`, checkpoint: base.checkpoint };
    },
    async execute() {
      throw new Error("not used");
    },
    async listFiles() {
      throw new Error("not used");
    },
    async readFile() {
      throw new Error("not used");
    },
    async writeFile() {
      throw new Error("not used");
    },
    async destroy(sandbox: SandboxHandle) {
      destroyed.push(sandbox.id);
    },
  };
  return { runner, createCalls, forkCalls, destroyed };
}

test("no regression reproduced: stops before any diagnostic step, reports inconclusive honestly", async (t) => {
  const fake = fakeRunner();
  const result = await runStableDiagnosis(
    { task, baseline, candidate, replication: POLICY },
    { runner: fake.runner, skipExplanation: true, runExperimentFn: scriptedRunExperimentFn({ "diag-baseline": [true, true], "diag-candidate": [true, true] }) },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(result.regressionDetected, false);
  assert.equal(result.steps.length, 0);
  assert.equal(result.diagnosis.type, "inconclusive");
  assert.equal(result.baselineAggregate.stability, "mostly_pass");
  assert.equal(result.candidateAggregate.stability, "mostly_pass");
  assert.equal(fake.forkCalls.length, 4, "2 baseline runs + 2 candidate runs, no diagnostic runs");
});

test("stable main-effect scenario: consistent per-run outcomes resolve to a main effect without needing any 3rd replicate run", async (t) => {
  const fake = fakeRunner();
  // Ground truth: fails iff skills=candidate, regardless of contextPolicy. Deterministic per config -> every
  // aggregate resolves cleanly at minRuns=2.
  const result = await runStableDiagnosis(
    { task, baseline, candidate, replication: POLICY },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: scriptedRunExperimentFn({
        "diag-baseline": [true, true],
        "diag-candidate": [false, false],
        "diagnostic-10": [false, false], // skills=candidate, contextPolicy=baseline
        "diagnostic-01": [true, true], // skills=baseline, contextPolicy=candidate
      }),
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(result.regressionDetected, true);
  assert.deepEqual(result.diagnosis, { type: "main_effect", factors: ["skills"] });
  assert.ok(result.aggregates.every((a) => a.runs.length === 2), "no configuration needed a 3rd replicate run — every aggregate resolved cleanly at minRuns");
  assert.equal(result.stability.evidenceQuality, "high");
  assert.equal(result.stability.unstableConfigurations.length, 0);
  assert.equal(result.totalCodingRuns, fake.forkCalls.length);
});

test("stable interaction scenario: fails only when both factors are at their candidate value, across repeated runs", async (t) => {
  const fake = fakeRunner();
  const result = await runStableDiagnosis(
    { task, baseline, candidate, replication: POLICY },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: scriptedRunExperimentFn({
        "diag-baseline": [true, true],
        "diag-candidate": [false, false],
        "diagnostic-10": [true, true],
        "diagnostic-01": [true, true],
      }),
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(result.regressionDetected, true);
  assert.deepEqual(result.diagnosis, { type: "interaction", factors: ["skills", "contextPolicy"] });
  assert.equal(result.stability.evidenceQuality, "high");
});

test("contradictory repeated evidence triggers a 3rd replicate run, and truly ambiguous evidence stays inconclusive and honest", async (t) => {
  const fake = fakeRunner();
  // isolate-skills (bits "10") disagrees with itself at minRuns (FAIL, then PASS) -> must trigger a 3rd run.
  // Its 3rd run (FAIL) lands at 2 FAIL / 1 PASS = 66.7% failure rate, which is deliberately still "unstable"
  // (see stability.ts thresholds) -> can never decide between main_effect:skills, main_effect:contextPolicy,
  // and interaction:skills+contextPolicy.
  const result = await runStableDiagnosis(
    { task, baseline, candidate, replication: POLICY },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: scriptedRunExperimentFn({
        "diag-baseline": [true, true],
        "diag-candidate": [false, false],
        "diagnostic-10": [false, true, false],
        "diagnostic-01": [false, true, false],
      }),
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(result.regressionDetected, true);
  const isolateSkills = result.aggregates.find((a) => a.configurationVector === "10")!;
  assert.equal(isolateSkills.runs.length, 3, "disagreement at minRuns triggered a 3rd replicate run");
  assert.equal(isolateSkills.stability, "unstable");
  assert.equal(result.diagnosis.type, "inconclusive");
  assert.equal(result.stability.evidenceQuality, "low");
  assert.ok(result.stability.unstableConfigurations.includes("10"));
  assert.ok(result.stability.unstableConfigurations.includes("01"));
});

test("total-run budget enforcement: a budget too small for any diagnostic run stops after baseline+candidate, inconclusive with remaining hypotheses reported", async (t) => {
  const fake = fakeRunner();
  const tightPolicy: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 4, reservedConfirmationRuns: 2 };
  const result = await runStableDiagnosis(
    { task, baseline, candidate, replication: tightPolicy },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: scriptedRunExperimentFn({ "diag-baseline": [true, true], "diag-candidate": [false, false] }),
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(result.totalCodingRuns, 4);
  assert.equal(result.steps.length, 0, "no budget left for any diagnostic run");
  assert.equal(result.diagnosis.type, "inconclusive");
  assert.equal(fake.forkCalls.length, 4);
});

test("evidence quality: high when every visited configuration resolves decisively, low when the diagnosis itself is inconclusive", () => {
  const decisive: ConfigurationAggregate[] = [
    { configurationVector: "00", configuration: {}, label: "baseline", runs: new Array(2).fill(null), passCount: 2, failCount: 0, passRate: 1, failureRate: 0, terminationReasons: {}, meanInputTokens: 0, meanOutputTokens: 0, meanLatencyMs: 0, stability: "mostly_pass", evidenceMaturity: "replicated", isDecisionCritical: false },
    { configurationVector: "11", configuration: {}, label: "candidate", runs: new Array(2).fill(null), passCount: 0, failCount: 2, passRate: 0, failureRate: 1, terminationReasons: {}, meanInputTokens: 0, meanOutputTokens: 0, meanLatencyMs: 0, stability: "mostly_fail", evidenceMaturity: "replicated", isDecisionCritical: false },
  ];
  const highQuality = computeStability(POLICY, decisive, "main_effect");
  assert.equal(highQuality.evidenceQuality, "high");
  assert.equal(highQuality.unstableConfigurations.length, 0);

  const withUnstable: ConfigurationAggregate[] = [
    ...decisive,
    { configurationVector: "10", configuration: {}, label: "isolate", runs: new Array(2).fill(null), passCount: 1, failCount: 1, passRate: 0.5, failureRate: 0.5, terminationReasons: {}, meanInputTokens: 0, meanOutputTokens: 0, meanLatencyMs: 0, stability: "unstable", evidenceMaturity: "unstable", isDecisionCritical: false },
  ];
  const lowQuality = computeStability(POLICY, withUnstable, "inconclusive");
  assert.equal(lowQuality.evidenceQuality, "low");
  assert.deepEqual(lowQuality.unstableConfigurations, ["10"]);

  // Same unstable evidence, but the diagnosis still resolved (it was irrelevant to the winning hypothesis) -> moderate, not low.
  const moderateQuality = computeStability(POLICY, withUnstable, "main_effect");
  assert.equal(moderateQuality.evidenceQuality, "moderate");
});

test("evidence quality: a merely 'provisional' (single-run, unconfirmed but not disagreeing) configuration is NOT treated as unstable", () => {
  const aggregates: ConfigurationAggregate[] = [
    { configurationVector: "00", configuration: {}, label: "baseline", runs: new Array(2).fill(null), passCount: 2, failCount: 0, passRate: 1, failureRate: 0, terminationReasons: {}, meanInputTokens: 0, meanOutputTokens: 0, meanLatencyMs: 0, stability: "mostly_pass", evidenceMaturity: "replicated", isDecisionCritical: false },
    { configurationVector: "11", configuration: {}, label: "candidate", runs: new Array(2).fill(null), passCount: 0, failCount: 2, passRate: 0, failureRate: 1, terminationReasons: {}, meanInputTokens: 0, meanOutputTokens: 0, meanLatencyMs: 0, stability: "mostly_fail", evidenceMaturity: "replicated", isDecisionCritical: false },
    // Explored once, turned out not to be decision-critical, correctly left at "provisional" forever — this is expected, efficient behavior, not a quality problem.
    { configurationVector: "10", configuration: {}, label: "explored-but-irrelevant", runs: new Array(1).fill(null), passCount: 1, failCount: 0, passRate: 1, failureRate: 0, terminationReasons: {}, meanInputTokens: 0, meanOutputTokens: 0, meanLatencyMs: 0, stability: "unstable", evidenceMaturity: "provisional", isDecisionCritical: false },
  ];
  const quality = computeStability(POLICY, aggregates, "main_effect");
  assert.equal(quality.evidenceQuality, "high", "a provisional-forever exploration must not be penalized as instability");
  assert.equal(quality.unstableConfigurations.length, 0);
});

test("repeatedConfigurations counts only configurations that needed MORE than minRuns", () => {
  const aggregates: ConfigurationAggregate[] = [
    { configurationVector: "00", configuration: {}, label: "a", runs: new Array(2).fill(null), passCount: 2, failCount: 0, passRate: 1, failureRate: 0, terminationReasons: {}, meanInputTokens: 0, meanOutputTokens: 0, meanLatencyMs: 0, stability: "mostly_pass", evidenceMaturity: "replicated", isDecisionCritical: false },
    { configurationVector: "11", configuration: {}, label: "b", runs: new Array(3).fill(null), passCount: 0, failCount: 3, passRate: 0, failureRate: 1, terminationReasons: {}, meanInputTokens: 0, meanOutputTokens: 0, meanLatencyMs: 0, stability: "mostly_fail", evidenceMaturity: "replicated", isDecisionCritical: false },
  ];
  const stability = computeStability(POLICY, aggregates, "main_effect");
  assert.equal(stability.repeatedConfigurations, 1, "only the 3-run configuration needed replication beyond minRuns=2");
});

test("shared checkpoint enforcement: exactly one shared base is prepared no matter how many runs/replicates occur", async (t) => {
  const fake = fakeRunner();
  const result = await runStableDiagnosis(
    { task, baseline, candidate, replication: POLICY },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: scriptedRunExperimentFn({
        "diag-baseline": [true, true],
        "diag-candidate": [false, false],
        "diagnostic-10": [false, true, false],
        "diagnostic-01": [true, true],
      }),
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(fake.createCalls.count, 1);
  assert.ok(fake.forkCalls.length > 0);
  // The fakeRunner's forkFrom itself asserts every base.id matches the shared handle; reaching here means it always held.
});

test("aggregates array has exactly one entry per distinct configuration, even after replicate runs accumulate", async (t) => {
  const fake = fakeRunner();
  const result = await runStableDiagnosis(
    { task, baseline, candidate, replication: POLICY },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: scriptedRunExperimentFn({
        "diag-baseline": [true, true],
        "diag-candidate": [false, false],
        "diagnostic-10": [false, true, false],
        "diagnostic-01": [true, true],
      }),
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  const bitsSeen = result.aggregates.map((a) => a.configurationVector);
  assert.equal(new Set(bitsSeen).size, bitsSeen.length, "no duplicate aggregate entries for the same configuration");
});

test("regression test: each step's aggregateAfter is a frozen point-in-time snapshot, never retroactively mutated by a later replicate run", async (t) => {
  const fake = fakeRunner();
  // "10" disagrees at minRuns (FAIL, then PASS), forcing a 3rd replicate run — exactly the shape that
  // previously exposed a shared-array-reference bug (an earlier step's aggregateAfter.runs would silently
  // grow to include runs recorded by a LATER step touching the same bits).
  const result = await runStableDiagnosis(
    { task, baseline, candidate, replication: POLICY },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: scriptedRunExperimentFn({
        "diag-baseline": [true, true],
        "diag-candidate": [false, false],
        "diagnostic-10": [false, true, false],
        "diagnostic-01": [true, true],
      }),
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  for (const step of result.steps) {
    const declaredRunCount = step.aggregateAfter.passCount + step.aggregateAfter.failCount;
    assert.equal(
      step.aggregateAfter.runs.length,
      declaredRunCount,
      `step ${step.step} (${step.bits}, ${step.action}): aggregateAfter.runs.length must match its own passCount+failCount at the time of this step, not a later step's run count`,
    );
  }

  // Directly confirm ordering: for bits "10", each successive step touching it must show a
  // strictly increasing run count (1, then 2, then 3) — never a count from the future.
  const tenSteps = result.steps.filter((s) => s.bits === "10");
  assert.deepEqual(tenSteps.map((s) => s.aggregateAfter.runs.length), [1, 2, 3]);
});

test("evidence file round-trips with no secret leakage", async (t) => {
  const fake = fakeRunner();
  const result = await runStableDiagnosis(
    { task, baseline, candidate, replication: POLICY },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: scriptedRunExperimentFn({
        "diag-baseline": [true, true],
        "diag-candidate": [false, false],
        "diagnostic-10": [false, false],
        "diagnostic-01": [true, true],
      }),
    },
  );
  const filePath = diagnosisEvidencePath(result.diagnosisId);
  t.after(() => fs.rmSync(filePath, { force: true }));

  const raw = fs.readFileSync(filePath, "utf8");
  assert.doesNotMatch(raw, /NEBIUS_API_KEY/);
  assert.doesNotMatch(raw, /sk-[A-Za-z0-9]{10,}/);
  assert.deepEqual(JSON.parse(raw).diagnosisId, result.diagnosisId);
});

test("explainFn is called exactly once with the diagnosis already fixed", async (t) => {
  const fake = fakeRunner();
  let explainCallCount = 0;
  const result = await runStableDiagnosis(
    { task, baseline, candidate, replication: POLICY },
    {
      runner: fake.runner,
      runExperimentFn: scriptedRunExperimentFn({
        "diag-baseline": [true, true],
        "diag-candidate": [false, false],
        "diagnostic-10": [false, false],
        "diagnostic-01": [true, true],
      }),
      explainFn: async (diagnosis) => {
        explainCallCount += 1;
        assert.equal(diagnosis.diagnosis.type, "main_effect");
        return "explanation text";
      },
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(explainCallCount, 1);
  assert.equal(result.mechanismExplanation, "explanation text");
});

// --- Milestone 8: budget-aware planner correctness ---

const DIMS4_BASELINE: HarnessManifest = { ...baselineV1, id: "diag4-baseline", name: "diag4-baseline", skills: [baselineSkill], contextPolicy: "full" };
const DIMS4_CANDIDATE: HarnessManifest = {
  ...baselineV1,
  id: "diag4-candidate",
  name: "diag4-candidate",
  skills: [verificationSkillV2],
  contextPolicy: "compact",
  systemPrompt: "a different, but individually-safe, system prompt",
  execution: { maxTurns: 9 },
};
const M7_BUDGET_POLICY: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 10, reservedConfirmationRuns: 2 };

/** Deterministic ground truth keyed by bit-vector, decoded from the manifest id (`diagnostic-XXXX`, or the fixed baseline/candidate ids). No stochasticity — the point is to test planner correctness, not replication behavior. */
function groundTruthRunExperimentFn(baselineId: string, candidateId: string, dims: number, predicate: (bits: string) => boolean) {
  return async (_t: CodingTask, manifest: HarnessManifest): Promise<ExperimentResult> => {
    const bits = manifest.id === baselineId ? "0".repeat(dims) : manifest.id === candidateId ? "1".repeat(dims) : manifest.id.replace("diagnostic-", "");
    return fakeResult(predicate(bits), manifest.id);
  };
}

// changedDimensions for DIMS4_BASELINE/DIMS4_CANDIDATE is ordered [systemPrompt, execution.maxTurns, skills,
// contextPolicy] (diffManifests' own fixed check order) -> skills is bit index 2, contextPolicy is index 3.
function skillsAndContextBothCandidate(bits: string): boolean {
  return bits[2] === "1" && bits[3] === "1";
}

test("Milestone 8 vs Milestone 7: the exact skills x contextPolicy interaction pattern (4 dims, systemPrompt/maxTurns as benign distractors) never produces a WRONG confirmed diagnosis, and never exceeds the 10-run budget", async (t) => {
  const fake = fakeRunner();
  // Ground truth: fails iff skills=candidate AND contextPolicy=candidate, regardless of systemPrompt/execution.maxTurns
  // — the exact mechanism from Milestones 4-7, plus two benign distractors.
  //
  // IMPORTANT: this does NOT assert the diagnosis resolves to "interaction" every time. With 10 hypotheses in
  // play and only 10 runs of budget, exploration alone can legitimately consume the whole budget across several
  // genuinely-relevant-looking configurations before ever reaching the one isolating contrast between the last
  // two survivors (main_effect:skills vs interaction:skills+contextPolicy) — this is exactly the information-
  // theoretic limitation Milestone 8's spec documents (section 12), and this reproduction confirmed it happens
  // even with the reserved-confirmation-budget fix in place (which correctly protects against wasting runs on
  // NON-decisive configs, but cannot manufacture runs that were never budgeted). What Milestone 8 guarantees is
  // narrower and still meaningful: it never CONFIRMS the wrong mechanism, and if it can't resolve within budget,
  // it says so honestly rather than guessing.
  const result = await runStableDiagnosis(
    { task, baseline: DIMS4_BASELINE, candidate: DIMS4_CANDIDATE, replication: M7_BUDGET_POLICY },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: groundTruthRunExperimentFn("diag4-baseline", "diag4-candidate", 4, (bits) => !skillsAndContextBothCandidate(bits)),
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.ok(result.totalCodingRuns <= 10, `must stay within the 10-run budget, used ${result.totalCodingRuns}`);

  if (result.diagnosis.type === "inconclusive") {
    // Must not have silently eliminated the true mechanism — it should still be among the reported alternatives.
    assert.match(result.diagnosis.reason, /interaction:skills\+contextPolicy/);
    assert.equal(result.stability.evidenceQuality, "low");
  } else {
    // If it DID resolve, it must have resolved CORRECTLY — never a false positive on an unrelated dimension.
    assert.deepEqual(result.diagnosis, { type: "interaction", factors: ["skills", "contextPolicy"] });
    assert.notEqual(result.stability.evidenceQuality, "low");
  }
});

test("Milestone 8 invariant: every 'confirm' step is decision-critical for the CONFIRMED-remaining hypotheses at the moment it was selected — the reserved budget is never spent on something irrelevant", async (t) => {
  const fake = fakeRunner();
  const result = await runStableDiagnosis(
    { task, baseline, candidate, replication: POLICY },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: scriptedRunExperimentFn({
        "diag-baseline": [true, true],
        "diag-candidate": [false, false],
        "diagnostic-10": [false, true, false],
        "diagnostic-01": [false, true, false],
      }),
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  const confirmSteps = result.steps.filter((s) => s.action === "confirm");
  assert.ok(confirmSteps.length > 0, "this scenario should have triggered at least one confirm step");
  for (const step of confirmSteps) {
    assert.ok(step.decisionCriticality > 0, `confirm step ${step.step} (${step.bits}) must have been decision-critical when selected`);
  }
});

test("Milestone 8: a genuinely under-budgeted 4-dim scenario stays honestly INCONCLUSIVE rather than forcing a wrong answer", async (t) => {
  const fake = fakeRunner();
  // A tiny budget (6 total: baseline 2 + candidate 2 + only 2 more) cannot possibly gather enough decisive
  // evidence to resolve a 10-hypothesis space beyond the trivial regression confirmation.
  const tinyPolicy: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 6, reservedConfirmationRuns: 1 };
  const result = await runStableDiagnosis(
    { task, baseline: DIMS4_BASELINE, candidate: DIMS4_CANDIDATE, replication: tinyPolicy },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: groundTruthRunExperimentFn("diag4-baseline", "diag4-candidate", 4, (bits) => !skillsAndContextBothCandidate(bits)),
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.ok(result.totalCodingRuns <= 6);
  assert.equal(result.diagnosis.type, "inconclusive");
  assert.ok((result.diagnosis as { reason: string }).reason.length > 0);
});
