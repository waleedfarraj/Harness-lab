import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { compareHarnesses, computeBehaviorDifferences } from "../src/lib/experiments/compare";
import { UncontrolledExperimentError } from "../src/lib/harness/diff";
import type { AgentToolCallRecord, AgentTrajectory } from "../src/lib/agent/types";
import type { CodingTask, ExperimentResult } from "../src/lib/experiments/types";
import type { HarnessManifest } from "../src/lib/harness/types";

/** compareHarnesses always writes real evidence to disk; tests must clean up after themselves. */
function comparisonEvidencePath(comparisonId: string): string {
  return path.join(process.cwd(), ".harnesslab", "comparisons", `${comparisonId}.json`);
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

const baselineManifest: HarnessManifest = {
  id: "baseline-v1",
  name: "Baseline",
  model: "m",
  systemPrompt: "base prompt",
  execution: { maxTurns: 8 },
  skills: [],
  contextPolicy: "full",
};
const candidateManifest: HarnessManifest = {
  ...baselineManifest,
  id: "candidate-v1",
  name: "Candidate",
  systemPrompt: "candidate prompt",
};

function toolCall(name: string, args: Record<string, unknown>): AgentToolCallRecord {
  return { id: `${name}-${JSON.stringify(args)}`, name, arguments: args, ok: true, resultSummary: "ok", resultChars: 2 };
}

function trajectory(toolCalls: AgentToolCallRecord[]): AgentTrajectory {
  return {
    turns: [
      {
        turn: 1,
        model: "m",
        assistantContent: null,
        toolCalls,
        startedAt: new Date().toISOString(),
        durationMs: 1,
        usage: null,
        request: {
          messageCount: 2,
          serializedSizeChars: 10,
          contextPolicy: "full",
          preservedToolResultIdentifiers: [],
          compactedToolResultIdentifiers: [],
          newCompactionEvents: [],
        },
      },
    ],
    toolCallCount: toolCalls.length,
    stopReason: "completed",
    terminationDetail: null,
    finalAssistantMessage: "done",
    totalUsage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
  };
}

function fakeResult(overrides: Partial<ExperimentResult> & { toolCalls: AgentToolCallRecord[] }): ExperimentResult {
  const { toolCalls, ...rest } = overrides;
  return {
    runId: "run-1",
    taskId: task.id,
    manifestId: "m",
    success: true,
    terminationReason: "completed",
    evaluation: { buildPassed: true, publicTestsPassed: true, hiddenTestsPassed: true, relevantTestsExecuted: true },
    changedFiles: ["src/a.ts"],
    metrics: { agentTurns: 3, toolCalls: toolCalls.length, latencyMs: 1000, inputTokens: 100, outputTokens: 10, totalTokens: 110 },
    evidence: { trajectory: trajectory(toolCalls), diff: "", evaluatorRaw: {}, sandbox: { runner: "local", handleId: "test" } },
    ...rest,
  };
}

test("compareHarnesses fails fast on an uncontrolled pair, without running any experiment", async () => {
  let called = false;
  await assert.rejects(
    () =>
      compareHarnesses({
        task,
        baseline: baselineManifest,
        candidate: { ...candidateManifest, model: "different-model" },
        expectedChangedDimensions: ["systemPrompt"],
        runExperimentFn: async () => {
          called = true;
          throw new Error("should not run");
        },
      }),
    UncontrolledExperimentError,
  );
  assert.equal(called, false);
});

test("compareHarnesses runs baseline then candidate and returns a full comparison", async (t) => {
  const baselineResult = fakeResult({
    manifestId: baselineManifest.id,
    toolCalls: [toolCall("read_file", { path: "src/a.ts" }), toolCall("run_command", { command: "npm test" })],
    metrics: { agentTurns: 8, toolCalls: 2, latencyMs: 1000, inputTokens: 200, outputTokens: 20, totalTokens: 220 },
  });
  const candidateResult = fakeResult({
    manifestId: candidateManifest.id,
    toolCalls: [toolCall("run_command", { command: "npm test" })],
    metrics: { agentTurns: 6, toolCalls: 1, latencyMs: 700, inputTokens: 100, outputTokens: 15, totalTokens: 115 },
  });

  const calledManifests: string[] = [];
  const comparison = await compareHarnesses({
    task,
    baseline: baselineManifest,
    candidate: candidateManifest,
    expectedChangedDimensions: ["systemPrompt"],
    runExperimentFn: async (_t, manifest) => {
      calledManifests.push(manifest.id);
      return manifest.id === baselineManifest.id ? baselineResult : candidateResult;
    },
  });
  t.after(() => fs.rmSync(comparisonEvidencePath(comparison.comparisonId), { force: true }));

  assert.deepEqual(calledManifests, [baselineManifest.id, candidateManifest.id]);
  assert.deepEqual(comparison.changedDimensions, ["systemPrompt"]);
  assert.equal(comparison.taskId, task.id);
  assert.equal(comparison.delta.agentTurns, -2);
  assert.equal(comparison.delta.toolCalls, -1);
  assert.equal(comparison.delta.latencyMs, -300);
  assert.equal(comparison.delta.inputTokens, -100);
  assert.equal(comparison.delta.successChanged, false);
  assert.ok(comparison.delta.behaviorDifferences.some((d) => d.includes("read src/a.ts")));
});

test("computeBehaviorDifferences reports file reads/writes and commands only one side did", () => {
  const baseline = fakeResult({
    toolCalls: [toolCall("read_file", { path: "src/a.ts" }), toolCall("run_command", { command: "npm run build" })],
  });
  const candidate = fakeResult({ toolCalls: [toolCall("run_command", { command: "npm test" })] });

  const diffs = computeBehaviorDifferences(baseline, candidate);
  assert.ok(diffs.some((d) => d === "Baseline read src/a.ts that Candidate did not"));
  assert.ok(diffs.some((d) => d.includes("Baseline ran `npm run build` that Candidate did not")));
  assert.ok(diffs.some((d) => d.includes("Candidate ran `npm test` that Baseline did not")));
});

test("computeBehaviorDifferences reports evaluation outcome differences", () => {
  const baseline = fakeResult({ toolCalls: [] });
  const candidate = fakeResult({
    toolCalls: [],
    success: false,
    evaluation: { buildPassed: true, publicTestsPassed: true, hiddenTestsPassed: false, relevantTestsExecuted: true },
  });

  const diffs = computeBehaviorDifferences(baseline, candidate);
  assert.ok(diffs.some((d) => d.includes("Hidden tests differed")));
});

test("computeBehaviorDifferences is empty for two otherwise-identical trajectories", () => {
  const calls = [toolCall("run_command", { command: "npm test" })];
  const baseline = fakeResult({ toolCalls: calls });
  const candidate = fakeResult({ toolCalls: calls });
  assert.deepEqual(computeBehaviorDifferences(baseline, candidate), []);
});
