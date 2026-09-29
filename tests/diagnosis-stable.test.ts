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

const POLICY: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 20 };

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
  const tightPolicy: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 4 };
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
    { configurationVector: "00", configuration: {}, label: "baseline", runs: [], passCount: 2, failCount: 0, passRate: 1, failureRate: 0, terminationReasons: {}, meanInputTokens: 0, meanOutputTokens: 0, meanLatencyMs: 0, stability: "mostly_pass" },
    { configurationVector: "11", configuration: {}, label: "candidate", runs: [], passCount: 0, failCount: 2, passRate: 0, failureRate: 1, terminationReasons: {}, meanInputTokens: 0, meanOutputTokens: 0, meanLatencyMs: 0, stability: "mostly_fail" },
  ];
  const highQuality = computeStability(POLICY, decisive, "main_effect");
  assert.equal(highQuality.evidenceQuality, "high");
  assert.equal(highQuality.unstableConfigurations.length, 0);

  const withUnstable: ConfigurationAggregate[] = [
    ...decisive,
    { configurationVector: "10", configuration: {}, label: "isolate", runs: [], passCount: 1, failCount: 1, passRate: 0.5, failureRate: 0.5, terminationReasons: {}, meanInputTokens: 0, meanOutputTokens: 0, meanLatencyMs: 0, stability: "unstable" },
  ];
  const lowQuality = computeStability(POLICY, withUnstable, "inconclusive");
  assert.equal(lowQuality.evidenceQuality, "low");
  assert.deepEqual(lowQuality.unstableConfigurations, ["10"]);

  // Same unstable evidence, but the diagnosis still resolved (it was irrelevant to the winning hypothesis) -> moderate, not low.
  const moderateQuality = computeStability(POLICY, withUnstable, "main_effect");
  assert.equal(moderateQuality.evidenceQuality, "moderate");
});

test("repeatedConfigurations counts only configurations that needed MORE than minRuns", () => {
  const aggregates: ConfigurationAggregate[] = [
    { configurationVector: "00", configuration: {}, label: "a", runs: new Array(2).fill(null), passCount: 2, failCount: 0, passRate: 1, failureRate: 0, terminationReasons: {}, meanInputTokens: 0, meanOutputTokens: 0, meanLatencyMs: 0, stability: "mostly_pass" },
    { configurationVector: "11", configuration: {}, label: "b", runs: new Array(3).fill(null), passCount: 0, failCount: 3, passRate: 0, failureRate: 1, terminationReasons: {}, meanInputTokens: 0, meanOutputTokens: 0, meanLatencyMs: 0, stability: "mostly_fail" },
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
