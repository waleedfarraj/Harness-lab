import "server-only";

import crypto from "node:crypto";
import path from "node:path";
import { runCodingAgent } from "../agent/coding-agent";
import { buildToolDefinitions, createToolExecutor } from "../agent/tools";
import { writeRunEvidence } from "./evidence";
import { LocalExperimentRunner } from "./local-runner";
import type { CodingTask, ExperimentResult } from "./types";

const DEFAULT_MAX_TURNS = 8;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_EXPERIMENT_TIMEOUT_MS = 5 * 60_000;

/**
 * Runs one coding task end to end: fresh workspace from the canonical
 * fixture -> bounded agent tool loop -> deterministic evaluation -> evidence
 * written to disk -> workspace destroyed. This is the one primitive
 * Milestone 1 proves; no comparisons, no repeated trials.
 */
export async function runExperiment(task: CodingTask): Promise<ExperimentResult> {
  const runId = crypto.randomUUID();
  const runner = new LocalExperimentRunner();
  const fixtureRoot = path.resolve(task.fixturePath);
  const sandbox = await runner.create({ label: task.id, fixturePath: task.fixturePath });
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
      instruction: task.instruction,
      toolDefinitions,
      executeTool,
      maxTurns: task.maxTurns ?? DEFAULT_MAX_TURNS,
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
      success,
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
        stopReason: trajectory.stopReason,
      },
    };

    writeRunEvidence(result);
    return result;
  } finally {
    await runner.destroy(sandbox);
  }
}
