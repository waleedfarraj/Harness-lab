import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { writeComparisonEvidence, writeDiagnosisEvidence, writeInteractionEvidence, writeRunEvidence } from "../src/lib/experiments/evidence";
import type { HarnessComparison } from "../src/lib/experiments/compare";
import type { FactorialInteractionResult } from "../src/lib/experiments/interaction";
import type { ExperimentResult } from "../src/lib/experiments/types";
import type { DiagnosisResult } from "../src/lib/diagnosis/types";

function sampleResult(runId: string): ExperimentResult {
  return {
    runId,
    taskId: "payment-retry-001",
    manifestId: "baseline-v1",
    success: true,
    terminationReason: "completed",
    evaluation: {
      buildPassed: true,
      publicTestsPassed: true,
      hiddenTestsPassed: true,
      relevantTestsExecuted: true,
    },
    changedFiles: ["src/paymentRetry.ts"],
    metrics: { agentTurns: 3, toolCalls: 5, latencyMs: 1234, inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    evidence: {
      trajectory: {
        turns: [],
        toolCallCount: 5,
        stopReason: "completed",
        terminationDetail: null,
        finalAssistantMessage: "done",
        totalUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      },
      diff: "--- a/src/paymentRetry.ts\n+++ b/src/paymentRetry.ts\n",
      evaluatorRaw: { build: { exitCode: 0 } },
      sandbox: { runner: "local", handleId: "run-handle" },
    },
  };
}

test("writeRunEvidence writes a JSON file that round-trips the full result, with no secret fields", () => {
  const runId = `test-${Date.now()}`;
  const result = sampleResult(runId);
  const filePath = writeRunEvidence(result);
  try {
    assert.equal(filePath, path.join(process.cwd(), ".harnesslab", "runs", `${runId}.json`));
    const raw = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(raw, /NEBIUS_API_KEY/);
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed, result);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test("writeComparisonEvidence writes a JSON file that round-trips the full comparison", () => {
  const comparisonId = `test-cmp-${Date.now()}`;
  const baseline = sampleResult("run-baseline");
  const candidate = sampleResult("run-candidate");
  const comparison: HarnessComparison = {
    comparisonId,
    taskId: "payment-retry-001",
    changedDimensions: ["systemPrompt"],
    baseline,
    candidate,
    delta: {
      successChanged: false,
      agentTurns: 0,
      toolCalls: 0,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      changedFilesAdded: [],
      changedFilesRemoved: [],
      behaviorDifferences: [],
    },
  };

  const filePath = writeComparisonEvidence(comparison);
  try {
    assert.equal(filePath, path.join(process.cwd(), ".harnesslab", "comparisons", `${comparisonId}.json`));
    const raw = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(raw, /NEBIUS_API_KEY/);
    assert.deepEqual(JSON.parse(raw), comparison);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test("writeInteractionEvidence writes a JSON file that round-trips all four cells", () => {
  const interactionId = `test-int-${Date.now()}`;
  const interaction: FactorialInteractionResult = {
    interactionId,
    taskId: "payment-retry-001",
    factors: [
      { name: "systemPrompt", baselineValue: "prompt-a", candidateValue: "prompt-b" },
      { name: "execution.maxTurns", baselineValue: 8, candidateValue: 7 },
    ],
    cells: [
      { cellId: "A", factors: { systemPrompt: "baseline", "execution.maxTurns": "baseline" }, result: sampleResult("A") },
      { cellId: "B", factors: { systemPrompt: "candidate", "execution.maxTurns": "baseline" }, result: sampleResult("B") },
      { cellId: "C", factors: { systemPrompt: "baseline", "execution.maxTurns": "candidate" }, result: sampleResult("C") },
      { cellId: "D", factors: { systemPrompt: "candidate", "execution.maxTurns": "candidate" }, result: sampleResult("D") },
    ],
    interactionContrast: 1,
    interactionObserved: true,
    behaviorEvidence: ["example evidence line"],
    sharedBaseCheckpoint: "chk-shared-base",
    environmentPreparationMs: 12000,
    forkTimingsMs: [10, 12, 9, 11],
  };

  const filePath = writeInteractionEvidence(interaction);
  try {
    assert.equal(filePath, path.join(process.cwd(), ".harnesslab", "interactions", `${interactionId}.json`));
    const raw = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(raw, /NEBIUS_API_KEY/);
    assert.deepEqual(JSON.parse(raw), interaction);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test("writeDiagnosisEvidence writes a JSON file that round-trips the full diagnosis, with no secret fields", () => {
  const diagnosisId = `test-diag-${Date.now()}`;
  const diagnosis: DiagnosisResult = {
    diagnosisId,
    taskId: "discount-apply-001",
    baselineResult: sampleResult("baseline-run"),
    candidateResult: { ...sampleResult("candidate-run"), success: false, terminationReason: "max_turns" },
    regressionDetected: true,
    changedDimensions: ["skills", "contextPolicy"],
    hypothesisSpace: [],
    experiments: [
      {
        step: 1,
        bits: "10",
        configuration: { skills: "candidate", contextPolicy: "baseline" },
        manifest: {
          id: "diagnostic-1",
          name: "diagnostic-1",
          model: "m",
          systemPrompt: "p",
          execution: { maxTurns: 8 },
          skills: [{ id: "verification-skill-v2", content: "c" }],
          contextPolicy: "full",
        },
        informationScore: 1,
        whySelected: "Distinguishes whether skills alone reproduces the regression.",
        hypothesesBefore: [],
        result: sampleResult("experiment-1-run"),
        hypothesesAfter: [],
        hypothesesRejected: [],
        hypothesesRemaining: [],
      },
    ],
    diagnosis: { type: "interaction", factors: ["skills", "contextPolicy"] },
    evidence: [
      { label: "baseline", bits: "00", configuration: { skills: "baseline", contextPolicy: "baseline" }, success: true },
      { label: "candidate", bits: "11", configuration: { skills: "candidate", contextPolicy: "candidate" }, success: false },
    ],
    fixedMechanismsObserved: ["read-file deduplication returned an \"unchanged\" marker instead of file content 1 time(s)"],
    mechanismExplanation: "Nemotron's explanation text.",
    experimentsRun: 1,
    exhaustiveConfigurations: 4,
    configurationsExecuted: 3,
    configurationsAvoided: 1,
    searchSpaceReductionPct: 25,
    sharedBaseCheckpoint: "chk-shared-base",
    environmentPreparationMs: 12000,
  };

  const filePath = writeDiagnosisEvidence(diagnosis);
  try {
    assert.equal(filePath, path.join(process.cwd(), ".harnesslab", "diagnoses", `${diagnosisId}.json`));
    const raw = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(raw, /NEBIUS_API_KEY/);
    assert.deepEqual(JSON.parse(raw), diagnosis);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});
