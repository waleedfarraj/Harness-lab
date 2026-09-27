import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { writeRunEvidence } from "../src/lib/experiments/evidence";
import type { ExperimentResult } from "../src/lib/experiments/types";

function sampleResult(runId: string): ExperimentResult {
  return {
    runId,
    taskId: "payment-retry-001",
    success: true,
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
        finalAssistantMessage: "done",
        totalUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      },
      diff: "--- a/src/paymentRetry.ts\n+++ b/src/paymentRetry.ts\n",
      evaluatorRaw: { build: { exitCode: 0 } },
      stopReason: "completed",
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
