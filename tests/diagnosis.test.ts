import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DuplicateConfigurationError, runDiagnosis } from "../src/lib/diagnosis/diagnose";
import { baselineV1 } from "../src/lib/harness/manifests/baseline-v1";
import { baselineSkill } from "../src/lib/harness/skills/baseline-skill";
import { verificationSkillV2 } from "../src/lib/harness/skills/verification-skill-v2";
import type { CodingTask, ExperimentResult } from "../src/lib/experiments/types";
import type { HarnessManifest } from "../src/lib/harness/types";
import type { SandboxHandle, SandboxRunner } from "../src/lib/sandbox/types";

function diagnosisEvidencePath(diagnosisId: string): string {
  return path.join(process.cwd(), ".harnesslab", "diagnoses", `${diagnosisId}.json`);
}

const task: CodingTask = {
  id: "fake-task",
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

function fakeResult(success: boolean, manifestId: string): ExperimentResult {
  return {
    runId: `run-${manifestId}`,
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

function fakeRunner(): { runner: SandboxRunner; createCalls: { count: number }; forkCalls: string[]; destroyed: string[] } {
  const createCalls = { count: 0 };
  const forkCalls: string[] = [];
  const destroyed: string[] = [];
  const runner: SandboxRunner = {
    async create() {
      createCalls.count += 1;
      return { id: "shared-base", checkpoint: "chk-shared-base" };
    },
    async forkFrom(base: SandboxHandle, label?: string) {
      forkCalls.push(label ?? "?");
      return { id: `${label}-fork`, checkpoint: base.checkpoint };
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

test("regression not reproduced: stops before any diagnostic experiment, reports inconclusive honestly", async (t) => {
  const fake = fakeRunner();
  const result = await runDiagnosis(
    { task, baseline, candidate, maxExperiments: 5 },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: async (_t, manifest) => fakeResult(true, manifest.id), // candidate ALSO passes this time
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(result.regressionDetected, false);
  assert.equal(result.experiments.length, 0);
  assert.equal(result.diagnosis.type, "inconclusive");
  assert.match((result.diagnosis as { reason: string }).reason, /did not regain|did not regress|stochastic/i);
  assert.equal(fake.forkCalls.length, 2, "only baseline + candidate forks, no diagnostic runs");
});

test("main effect: resolves after exactly one diagnostic experiment when it already fails", async (t) => {
  const fake = fakeRunner();
  const result = await runDiagnosis(
    { task, baseline, candidate, maxExperiments: 5 },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: async (_t, manifest) => fakeResult(manifest.id === "diag-baseline", manifest.id),
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(result.regressionDetected, true);
  assert.equal(result.experimentsRun, 1);
  // The adaptive planner's deterministic tie-break picks the lexicographically smallest bit
  // string among equally-informative candidates; for changedDimensions=[skills, contextPolicy]
  // that's bits="01" (contextPolicy isolated alone), not "10" (skills isolated alone).
  assert.deepEqual(result.diagnosis, { type: "main_effect", factors: ["contextPolicy"] });
  assert.equal(fake.forkCalls.length, 3, "baseline + candidate + 1 diagnostic fork");
  assert.equal(fake.createCalls.count, 1, "the shared base is prepared exactly once");
});

test("interaction: resolves after exactly two diagnostic experiments when both isolated factors are safe", async (t) => {
  const fake = fakeRunner();
  const result = await runDiagnosis(
    { task, baseline, candidate, maxExperiments: 5 },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: async (_t, manifest) => {
        if (manifest.id === "diag-baseline") return fakeResult(true, manifest.id);
        if (manifest.id === "diagnostic-1" || manifest.id === "diagnostic-2") return fakeResult(true, manifest.id);
        return fakeResult(false, manifest.id); // the real candidate manifest keeps its own id
      },
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(result.experimentsRun, 2);
  assert.deepEqual(result.diagnosis, { type: "interaction", factors: ["skills", "contextPolicy"] });
  assert.equal(fake.forkCalls.length, 4, "baseline + candidate + 2 diagnostic forks");
});

test("budget enforcement: maxExperiments=0 runs zero diagnostic experiments even though evidence is inconclusive", async (t) => {
  const fake = fakeRunner();
  const result = await runDiagnosis(
    { task, baseline, candidate, maxExperiments: 0 },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: async (_t, manifest) => fakeResult(manifest.id === "diag-baseline", manifest.id),
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(result.experimentsRun, 0);
  assert.equal(result.diagnosis.type, "inconclusive");
  assert.equal(fake.forkCalls.length, 2, "only baseline + candidate; the budget forbids any diagnostic fork");
});

test("explainFn is called exactly once, with the diagnosis already fixed, and its output becomes mechanismExplanation", async (t) => {
  const fake = fakeRunner();
  let explainCallCount = 0;
  let receivedDiagnosisType: string | undefined;
  const result = await runDiagnosis(
    { task, baseline, candidate, maxExperiments: 5 },
    {
      runner: fake.runner,
      runExperimentFn: async (_t, manifest) => fakeResult(manifest.id === "diag-baseline" || manifest.id === "diagnostic-1", manifest.id),
      explainFn: async (diagnosis) => {
        explainCallCount += 1;
        receivedDiagnosisType = diagnosis.diagnosis.type;
        return "Nemotron's explanation text.";
      },
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(explainCallCount, 1);
  assert.equal(receivedDiagnosisType, result.diagnosis.type, "explainFn sees the classification already fixed");
  assert.equal(result.mechanismExplanation, "Nemotron's explanation text.");
});

test("skipExplanation:true never calls explainFn and leaves mechanismExplanation null", async (t) => {
  const fake = fakeRunner();
  let called = false;
  const result = await runDiagnosis(
    { task, baseline, candidate, maxExperiments: 5 },
    {
      runner: fake.runner,
      skipExplanation: true,
      runExperimentFn: async (_t, manifest) => fakeResult(manifest.id === "diag-baseline" || manifest.id === "diagnostic-1", manifest.id),
      explainFn: async () => {
        called = true;
        return "should not run";
      },
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(called, false);
  assert.equal(result.mechanismExplanation, null);
});

test("duplicate-configuration guard fails loudly if the planner ever re-requests an already-known configuration (simulated planner bug)", async () => {
  const fake = fakeRunner();
  let calls = 0;
  await assert.rejects(
    runDiagnosis(
      { task, baseline, candidate, maxExperiments: 5 },
      {
        runner: fake.runner,
        skipExplanation: true,
        runExperimentFn: async (_t, manifest) => fakeResult(manifest.id === "diag-baseline", manifest.id),
        // A broken selector that always re-proposes the candidate's own configuration ("11") —
        // something the real selectNextExperiment can never do, since it always excludes testedBits.
        selectNextExperimentFn: () => {
          calls += 1;
          return { bits: "11", configuration: { skills: "candidate", contextPolicy: "candidate" }, informationScore: 1, predictedPass: 1, predictedFail: 1, whySelected: "broken test stub" };
        },
      },
    ),
    DuplicateConfigurationError,
  );
  assert.equal(calls, 1);
});

test("budget exhaustion: maxExperiments too small to uniquely resolve -> inconclusive, remaining hypotheses reported honestly", async (t) => {
  const fake = fakeRunner();
  const result = await runDiagnosis(
    { task, baseline, candidate, maxExperiments: 1 },
    {
      runner: fake.runner,
      skipExplanation: true,
      // Both isolating cells would need to pass to diagnose an interaction, but the budget only allows one.
      runExperimentFn: async (_t, manifest) => fakeResult(manifest.id === "diag-baseline" || manifest.id === "diagnostic-1", manifest.id),
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.equal(result.experimentsRun, 1);
  assert.equal(result.diagnosis.type, "inconclusive");
  assert.match((result.diagnosis as { reason: string }).reason, /hypotheses remain/);
  assert.equal(fake.forkCalls.length, 3, "budget stopped after baseline + candidate + 1 diagnostic fork");
});

test("4-dimension adaptive diagnosis: resolves skills x contextPolicy interaction with two benign distractor dimensions, in fewer than 16 configurations", async (t) => {
  const baseline4: HarnessManifest = { ...baselineV1, id: "diag4-baseline", name: "diag4-baseline", skills: [baselineSkill], contextPolicy: "full" };
  const candidate4: HarnessManifest = {
    ...baselineV1,
    id: "diag4-candidate",
    name: "diag4-candidate",
    skills: [verificationSkillV2],
    contextPolicy: "compact",
    systemPrompt: "Be concise. Read only what you need, make the smallest correct change, run tests, stop.",
    execution: { maxTurns: 9 },
  };

  const fake = fakeRunner();
  const result = await runDiagnosis(
    { task, baseline: baseline4, candidate: candidate4, maxExperiments: 6 },
    {
      runner: fake.runner,
      skipExplanation: true,
      // Ground truth: only skills=candidate AND contextPolicy=candidate together fail. systemPrompt and
      // execution.maxTurns are genuine no-ops regardless of their own or skills/contextPolicy's value.
      runExperimentFn: async (_t, manifest) => {
        const skillIds = manifest.skills.map((s) => s.id);
        const skillsCandidate = skillIds.includes(verificationSkillV2.id);
        const contextCandidate = manifest.contextPolicy === "compact";
        return fakeResult(!(skillsCandidate && contextCandidate), manifest.id);
      },
    },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.deepEqual([...result.changedDimensions].sort(), ["contextPolicy", "execution.maxTurns", "skills", "systemPrompt"]);
  assert.equal(result.hypothesisSpace.length, 10, "4 main effects + 6 pairwise interactions");
  assert.equal(result.diagnosis.type, "interaction");
  assert.equal((result.diagnosis as { type: "interaction"; factors: string[] }).factors.slice().sort().join("+"), "contextPolicy+skills");
  assert.equal(result.exhaustiveConfigurations, 16);
  assert.ok(result.configurationsExecuted < 16, `expected materially fewer than 16 configurations, got ${result.configurationsExecuted}`);
  assert.equal(result.configurationsExecuted, result.experimentsRun + 2);
  assert.equal(result.configurationsAvoided, 16 - result.configurationsExecuted);
  assert.equal(Math.round(result.searchSpaceReductionPct), Math.round((result.configurationsAvoided / 16) * 100));

  // No duplicate configuration was ever executed.
  const executedBits = [result.evidence[0].bits, result.evidence[1].bits, ...result.experiments.map((e) => e.bits)];
  assert.equal(new Set(executedBits).size, executedBits.length, "every executed configuration is unique");

  // Only one shared checkpoint was prepared, no matter how many diagnostic forks ran.
  assert.equal(fake.createCalls.count, 1);
});

test("changedDimensions is derived automatically and never hard-codes a caller-supplied cause", async (t) => {
  const fake = fakeRunner();
  const result = await runDiagnosis(
    { task, baseline, candidate, maxExperiments: 5 },
    { runner: fake.runner, skipExplanation: true, runExperimentFn: async (_t, manifest) => fakeResult(manifest.id === "diag-baseline", manifest.id) },
  );
  t.after(() => fs.rmSync(diagnosisEvidencePath(result.diagnosisId), { force: true }));

  assert.deepEqual([...result.changedDimensions].sort(), ["contextPolicy", "skills"]);
});
