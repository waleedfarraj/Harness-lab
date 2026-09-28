import "server-only";

import crypto from "node:crypto";
import path from "node:path";
import { runCodingAgent } from "../agent/coding-agent";
import { buildToolDefinitions, createToolExecutor } from "../agent/tools";
import type { HarnessManifest } from "../harness/types";
import { validateHarnessManifest } from "../harness/validate";
import { createSandboxRunner, resolveRunnerKind } from "../sandbox/runner-config";
import { writeRunEvidence } from "./evidence";
import type { CodingTask, ExperimentResult } from "./types";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_EXPERIMENT_TIMEOUT_MS = 5 * 60_000;

/**
 * Runs one coding task, under one explicit HarnessManifest, end to end:
 * fresh workspace from the canonical fixture -> bounded agent tool loop
 * (model/systemPrompt/maxTurns all from `manifest`) -> deterministic
 * evaluation -> evidence written to disk -> workspace destroyed.
 */
export async function runExperiment(task: CodingTask, manifest: HarnessManifest): Promise<ExperimentResult> {
  validateHarnessManifest(manifest);
  const runId = crypto.randomUUID();
  const runnerKind = resolveRunnerKind();
  const runner = createSandboxRunner();
  const fixtureRoot = path.resolve(task.fixturePath);
  const sandbox = await runner.create({ label: `${task.id}-${manifest.id}`, fixturePath: task.fixturePath });
  const startedAt = performance.now();

  try {
    const signal = AbortSignal.timeout(task.experimentTimeoutMs ?? DEFAULT_EXPERIMENT_TIMEOUT_MS);
    const toolDefinitions = buildToolDefinitions(task.allowedCommands);
    const executeTool = createToolExecutor({
      runner,
      sandbox,
      allowedCommands: task.allowedCommands,
      commandTimeoutMs: task.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    });

    const trajectory = await runCodingAgent({
      model: manifest.model,
      systemPrompt: manifest.systemPrompt,
      instruction: task.instruction,
      toolDefinitions,
      executeTool,
      maxTurns: manifest.execution.maxTurns,
      signal,
    });

    const outcome = await task.evaluator({ runner, sandbox, fixtureRoot, trajectory });
    const success =
      outcome.evaluation.buildPassed &&
      outcome.evaluation.publicTestsPassed &&
      outcome.evaluation.hiddenTestsPassed &&
      outcome.evaluation.relevantTestsExecuted;

    const result: ExperimentResult = {
      runId,
      taskId: task.id,
      manifestId: manifest.id,
      success,
      terminationReason: trajectory.stopReason,
      evaluation: outcome.evaluation,
      changedFiles: outcome.changedFiles,
      metrics: {
        agentTurns: trajectory.turns.length,
        toolCalls: trajectory.toolCallCount,
        latencyMs: Math.round(performance.now() - startedAt),
        inputTokens: trajectory.totalUsage.inputTokens,
        outputTokens: trajectory.totalUsage.outputTokens,
        totalTokens: trajectory.totalUsage.totalTokens,
      },
      evidence: {
        trajectory,
        diff: outcome.diff,
        evaluatorRaw: outcome.raw,
        sandbox: { runner: runnerKind, handleId: sandbox.id, metadata: sandbox.metadata },
      },
    };

    writeRunEvidence(result);
    return result;
  } finally {
    await runner.destroy(sandbox);
  }
}
