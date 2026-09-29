import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExplanationPrompt } from "../src/lib/diagnosis/explain";
import type { DiagnosisResult } from "../src/lib/diagnosis/types";
import type { ExperimentResult } from "../src/lib/experiments/types";

function fakeResult(success: boolean, terminationReason: ExperimentResult["terminationReason"]): ExperimentResult {
  return {
    runId: "run",
    taskId: "discount-apply-001",
    manifestId: "m",
    success,
    terminationReason,
    evaluation: { buildPassed: true, publicTestsPassed: success, hiddenTestsPassed: success, relevantTestsExecuted: success },
    changedFiles: success ? ["src/applyDiscount.ts"] : [],
    metrics: { agentTurns: 8, toolCalls: 8, latencyMs: 1000, inputTokens: 100, outputTokens: 10, totalTokens: 110 },
    evidence: {
      trajectory: {
        turns: [
          {
            turn: 1,
            model: "m",
            assistantContent: null,
            toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "src/a.ts" }, ok: true, resultSummary: "(unchanged since your last read of src/a.ts)", resultChars: 10 }],
            startedAt: new Date().toISOString(),
            durationMs: 1,
            usage: null,
            request: { messageCount: 2, serializedSizeChars: 10, contextPolicy: "compact", preservedToolResultIdentifiers: [], compactedToolResultIdentifiers: ["src/a.ts"], newCompactionEvents: [] },
          },
        ],
        toolCallCount: 1,
        stopReason: terminationReason,
        terminationDetail: null,
        finalAssistantMessage: null,
        totalUsage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      },
      diff: "",
      evaluatorRaw: {},
      sandbox: { runner: "token-factory", handleId: "h" },
    },
  };
}

function fakeDiagnosis(): DiagnosisResult {
  return {
    diagnosisId: "diag-1",
    taskId: "discount-apply-001",
    baselineResult: fakeResult(true, "completed"),
    candidateResult: fakeResult(false, "max_turns"),
    regressionDetected: true,
    changedDimensions: ["skills", "contextPolicy"],
    hypothesisSpace: [],
    experiments: [],
    diagnosis: { type: "interaction", factors: ["skills", "contextPolicy"] },
    evidence: [
      { label: "baseline", bits: "00", configuration: { skills: "baseline", contextPolicy: "baseline" }, success: true },
      { label: "candidate", bits: "11", configuration: { skills: "candidate", contextPolicy: "candidate" }, success: false },
    ],
    fixedMechanismsObserved: ['read-file deduplication returned an "unchanged" marker instead of file content 1 time(s)'],
    mechanismExplanation: null,
    experimentsRun: 2,
    exhaustiveConfigurations: 4,
    configurationsExecuted: 4,
    configurationsAvoided: 0,
    searchSpaceReductionPct: 0,
    sharedBaseCheckpoint: "chk-shared",
    environmentPreparationMs: 12000,
  };
}

test("buildExplanationPrompt states the deterministic classification as already fixed", () => {
  const prompt = buildExplanationPrompt(fakeDiagnosis());
  assert.match(prompt, /already determined/i);
  assert.match(prompt, /interaction/);
  assert.match(prompt, /skills x contextPolicy/);
  assert.match(prompt, /Do not decide or restate/i);
});

test("buildExplanationPrompt includes the experiment table and evidence", () => {
  const prompt = buildExplanationPrompt(fakeDiagnosis());
  assert.match(prompt, /baseline: PASS/);
  assert.match(prompt, /candidate: FAIL/);
  assert.match(prompt, /skills/);
  assert.match(prompt, /contextPolicy/);
});

test("buildExplanationPrompt includes fixed-mechanism evidence, distinct from changed dimensions", () => {
  const prompt = buildExplanationPrompt(fakeDiagnosis());
  assert.match(prompt, /Fixed mechanisms observed/);
  assert.match(prompt, /read-file deduplication/);
});

test("buildExplanationPrompt includes the failing trajectory's termination reason and tool calls", () => {
  const prompt = buildExplanationPrompt(fakeDiagnosis());
  assert.match(prompt, /max_turns/);
  assert.match(prompt, /read_file/);
});

test("buildExplanationPrompt never contains a secret", () => {
  const prompt = buildExplanationPrompt(fakeDiagnosis());
  assert.doesNotMatch(prompt, /NEBIUS_API_KEY/);
  assert.doesNotMatch(prompt, /sk-[A-Za-z0-9]{10,}/);
});
