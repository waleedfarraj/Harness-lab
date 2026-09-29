import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { computeFactorialBehaviorEvidence, runFactorialExperiment, type FactorialCellOutcome } from "../src/lib/experiments/interaction";
import { UncontrolledFactorialExperimentError } from "../src/lib/harness/factorial";
import type { FactorDefinition } from "../src/lib/harness/factorial";
import type { HarnessManifest } from "../src/lib/harness/types";
import type { AgentTerminationReason, AgentTrajectory } from "../src/lib/agent/types";
import type { CodingTask, ExperimentResult } from "../src/lib/experiments/types";
import type { SandboxHandle, SandboxRunner } from "../src/lib/sandbox/types";

/** runFactorialExperiment always writes real evidence to disk; tests must clean up after themselves. */
function interactionEvidencePath(interactionId: string): string {
  return path.join(process.cwd(), ".harnesslab", "interactions", `${interactionId}.json`);
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

const baseManifest: HarnessManifest = {
  id: "base",
  name: "Base",
  model: "shared-model",
  systemPrompt: "prompt-a",
  execution: { maxTurns: 8 },
  skills: [],
  contextPolicy: "full",
};

const promptFactor: FactorDefinition<string> = { name: "systemPrompt", baselineValue: "prompt-a", candidateValue: "prompt-b" };
const turnsFactor: FactorDefinition<number> = { name: "execution.maxTurns", baselineValue: 8, candidateValue: 7 };

function trajectory(terminationReason: AgentTerminationReason, agentTurns: number): AgentTrajectory {
  return {
    turns: Array.from({ length: agentTurns }, (_v, i) => ({
      turn: i + 1,
      model: "shared-model",
      assistantContent: null,
      toolCalls: [],
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
    })),
    toolCallCount: 0,
    stopReason: terminationReason,
    terminationDetail: terminationReason === "completed" || terminationReason === "max_turns" ? null : "simulated failure",
    finalAssistantMessage: terminationReason === "completed" ? "done" : null,
    totalUsage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
  };
}

function fakeResult(success: boolean, terminationReason: AgentTerminationReason, agentTurns: number, manifestId: string): ExperimentResult {
  return {
    runId: `run-${manifestId}`,
    taskId: task.id,
    manifestId,
    success,
    terminationReason,
    evaluation: {
      buildPassed: true,
      publicTestsPassed: success,
      hiddenTestsPassed: success,
      relevantTestsExecuted: terminationReason !== "max_turns",
    },
    changedFiles: ["src/a.ts"],
    metrics: { agentTurns, toolCalls: agentTurns, latencyMs: 1000, inputTokens: 100, outputTokens: 10, totalTokens: 110 },
    evidence: {
      trajectory: trajectory(terminationReason, agentTurns),
      diff: "",
      evaluatorRaw: {},
      sandbox: { runner: "local", handleId: "test" },
    },
  };
}

function fakeSharedRunner(): { runner: SandboxRunner; createCalls: number; forkCalls: SandboxHandle[]; destroyed: SandboxHandle[] } {
  let createCalls = 0;
  const forkCalls: SandboxHandle[] = [];
  const destroyed: SandboxHandle[] = [];
  const runner: SandboxRunner = {
    async create() {
      createCalls += 1;
      return { id: "shared-base", checkpoint: "chk-shared-base" };
    },
    async forkFrom(base, label) {
      const handle = { id: `${label}-fork`, checkpoint: base.checkpoint };
      forkCalls.push(handle);
      return handle;
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
    async destroy(sandbox) {
      destroyed.push(sandbox);
    },
  };
  return { runner, createCalls, forkCalls, destroyed };
}

test("runFactorialExperiment with sharedCheckpoint prepares the base once and forks each of the four cells from it", async (t) => {
  const shared = fakeSharedRunner();
  const passResult = (id: string) => fakeResult(true, "completed", 7, id);
  const cellSandboxes: (SandboxHandle | undefined)[] = [];

  const interaction = await runFactorialExperiment({
    task,
    factors: [promptFactor, turnsFactor],
    baseManifest,
    sharedCheckpoint: true,
    runner: shared.runner,
    runExperimentFn: async (_t, manifest, options) => {
      cellSandboxes.push(options?.sandbox);
      return passResult(manifest.id);
    },
  });
  t.after(() => fs.rmSync(interactionEvidencePath(interaction.interactionId), { force: true }));

  assert.equal(shared.forkCalls.length, 4, "one fork per cell");
  assert.equal(cellSandboxes.length, 4);
  for (const sandbox of cellSandboxes) {
    assert.equal(sandbox?.checkpoint, "chk-shared-base", "every cell forks from the same shared checkpoint");
  }
  assert.equal(interaction.sharedBaseCheckpoint, "chk-shared-base");
  assert.equal(typeof interaction.environmentPreparationMs, "number");
  assert.equal(interaction.forkTimingsMs.length, 4);
  assert.deepEqual(shared.destroyed.map((h) => h.id).sort(), ["shared-base"], "only the shared base is destroyed by the orchestrator itself");
});

test("runFactorialExperiment calls the runner exactly once per cell, with the task/model held identical", async (t) => {
  const calledManifests: HarnessManifest[] = [];
  const outcomes: Record<string, ExperimentResult> = {
    "systemPrompt=baseline,execution.maxTurns=baseline": fakeResult(true, "completed", 8, "A"),
    "systemPrompt=candidate,execution.maxTurns=baseline": fakeResult(true, "completed", 7, "B"),
    "systemPrompt=baseline,execution.maxTurns=candidate": fakeResult(false, "max_turns", 7, "C"),
    "systemPrompt=candidate,execution.maxTurns=candidate": fakeResult(true, "completed", 7, "D"),
  };

  const interaction = await runFactorialExperiment({
    task,
    factors: [promptFactor, turnsFactor],
    baseManifest,
    runExperimentFn: async (calledTask, manifest) => {
      assert.equal(calledTask.id, task.id);
      assert.equal(manifest.model, baseManifest.model);
      calledManifests.push(manifest);
      const outcome = outcomes[manifest.id];
      if (!outcome) throw new Error(`unexpected manifest id ${manifest.id}`);
      return outcome;
    },
  });
  t.after(() => fs.rmSync(interactionEvidencePath(interaction.interactionId), { force: true }));

  assert.equal(calledManifests.length, 4, "exactly one call per cell, no accidental retries");
  assert.equal(new Set(calledManifests.map((m) => m.id)).size, 4);
  assert.equal(interaction.cells.length, 4);
});

test("interaction contrast is 1 for the seeded PASS/PASS/FAIL/PASS pattern", async (t) => {
  const outcomes: Record<string, ExperimentResult> = {
    "systemPrompt=baseline,execution.maxTurns=baseline": fakeResult(true, "completed", 8, "A"),
    "systemPrompt=candidate,execution.maxTurns=baseline": fakeResult(true, "completed", 7, "B"),
    "systemPrompt=baseline,execution.maxTurns=candidate": fakeResult(false, "max_turns", 7, "C"),
    "systemPrompt=candidate,execution.maxTurns=candidate": fakeResult(true, "completed", 7, "D"),
  };
  const interaction = await runFactorialExperiment({
    task,
    factors: [promptFactor, turnsFactor],
    baseManifest,
    runExperimentFn: async (_t, manifest) => outcomes[manifest.id],
  });
  t.after(() => fs.rmSync(interactionEvidencePath(interaction.interactionId), { force: true }));

  assert.equal(interaction.interactionContrast, 1);
  assert.equal(interaction.interactionObserved, true);
});

test("interaction contrast is 0 when all four cells pass (no interaction)", async (t) => {
  const passResult = (id: string) => fakeResult(true, "completed", 7, id);
  const interaction = await runFactorialExperiment({
    task,
    factors: [promptFactor, turnsFactor],
    baseManifest,
    runExperimentFn: async (_t, manifest) => passResult(manifest.id),
  });
  t.after(() => fs.rmSync(interactionEvidencePath(interaction.interactionId), { force: true }));

  assert.equal(interaction.interactionContrast, 0);
  assert.equal(interaction.interactionObserved, false);
});

test("runFactorialExperiment fails fast, without calling the runner, if a factor never actually varies", async () => {
  const brokenTurnsFactor: FactorDefinition<number> = { name: "execution.maxTurns", baselineValue: 8, candidateValue: 8 };
  let called = false;
  await assert.rejects(
    () =>
      runFactorialExperiment({
        task,
        factors: [promptFactor, brokenTurnsFactor],
        baseManifest,
        runExperimentFn: async () => {
          called = true;
          throw new Error("should not run");
        },
      }),
    UncontrolledFactorialExperimentError,
  );
  assert.equal(called, false);
});

test("computeFactorialBehaviorEvidence reports max_turns vs completed asymmetry deterministically", () => {
  function cell(id: string, terminationReason: AgentTerminationReason, agentTurns: number): FactorialCellOutcome {
    return { cellId: id, factors: {}, result: fakeResult(terminationReason === "completed", terminationReason, agentTurns, id) };
  }
  const evidence = computeFactorialBehaviorEvidence({
    A: cell("A", "completed", 8),
    B: cell("B", "completed", 7),
    C: cell("C", "max_turns", 7),
    D: cell("D", "completed", 7),
  });

  assert.ok(evidence.some((l) => l.includes("C") && l.includes("max-turn limit")));
  assert.ok(evidence.some((l) => l.includes("D") && l.includes("completed naturally")));
  assert.ok(evidence.some((l) => l.startsWith("Result differs:")));
});

test("computeFactorialBehaviorEvidence uses custom labels when given", () => {
  function cell(id: string, terminationReason: AgentTerminationReason, agentTurns: number): FactorialCellOutcome {
    return { cellId: id, factors: {}, result: fakeResult(terminationReason === "completed", terminationReason, agentTurns, id) };
  }
  const evidence = computeFactorialBehaviorEvidence(
    { A: cell("A", "completed", 8), B: cell("B", "completed", 7), C: cell("C", "max_turns", 7), D: cell("D", "completed", 7) },
    { A: "baseline+full", B: "verification+full", C: "baseline+compact", D: "verification+compact" },
  );
  assert.ok(evidence.some((l) => l.includes("baseline+compact") && l.includes("max-turn limit")));
});
