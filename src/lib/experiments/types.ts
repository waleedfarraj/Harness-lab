import "server-only";

import type { AgentTerminationReason, AgentTrajectory } from "../agent/types";
import type { RunnerKind } from "../sandbox/runner-config";
import type { SandboxHandle, SandboxRunner } from "../sandbox/types";

export interface EvaluatorContext {
  runner: SandboxRunner;
  sandbox: SandboxHandle;
  fixtureRoot: string;
  trajectory: AgentTrajectory;
}

export interface EvaluationFlags {
  buildPassed: boolean;
  publicTestsPassed: boolean;
  hiddenTestsPassed: boolean;
  relevantTestsExecuted: boolean;
}

export interface EvaluationOutcome {
  evaluation: EvaluationFlags;
  changedFiles: string[];
  diff: string;
  /** Raw evaluator command output kept for evidence; HarnessLab's booleans above are authoritative, not this. */
  raw: Record<string, unknown>;
}

export type TaskEvaluator = (ctx: EvaluatorContext) => Promise<EvaluationOutcome>;

export interface CodingTask {
  id: string;
  title: string;
  /** The instruction given to the agent. Deliberately does not name the exact implementation. */
  instruction: string;
  /** Path (relative to the repo root) to the canonical, never-mutated fixture directory. */
  fixturePath: string;
  /** Exact command strings the agent's run_command tool may execute. */
  allowedCommands: string[];
  evaluator: TaskEvaluator;
  /** Infra-level safety bounds, not a harness axis — these stay fixed across every manifest a task is run under. */
  commandTimeoutMs?: number;
  experimentTimeoutMs?: number;
}

export interface ExperimentMetrics {
  agentTurns: number;
  toolCalls: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ExperimentResult {
  runId: string;
  taskId: string;
  /** Which HarnessManifest produced this result — the explicit config, not a hidden default. */
  manifestId: string;
  success: boolean;
  /** Why the agent loop stopped. See `AgentTerminationReason` — important for telling "ran out of turns" apart from "broke". */
  terminationReason: AgentTerminationReason;
  evaluation: EvaluationFlags;
  changedFiles: string[];
  metrics: ExperimentMetrics;
  evidence: {
    trajectory: AgentTrajectory;
    diff: string;
    evaluatorRaw: Record<string, unknown>;
    /** Which runner actually executed this, plus whatever runner-specific metadata it provided (e.g. base image, checkpoint id). Never fabricated. */
    sandbox: { runner: RunnerKind; handleId: string; metadata?: Record<string, unknown> };
  };
}
