import "server-only";

import crypto from "node:crypto";
import { assertControlledExperiment } from "../harness/diff";
import type { HarnessDimension, HarnessManifest } from "../harness/types";
import { validateHarnessManifest } from "../harness/validate";
import { writeComparisonEvidence } from "./evidence";
import { runExperiment as defaultRunExperiment } from "./run-experiment";
import type { CodingTask, ExperimentResult } from "./types";
import type { AgentTrajectory } from "../agent/types";

export interface ComparisonDelta {
  successChanged: boolean;
  agentTurns: number;
  toolCalls: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  changedFilesAdded: string[];
  changedFilesRemoved: string[];
  /** Deterministic, evidence-derived differences. Never LLM-generated. */
  behaviorDifferences: string[];
}

export interface HarnessComparison {
  comparisonId: string;
  taskId: string;
  changedDimensions: HarnessDimension[];
  baseline: ExperimentResult;
  candidate: ExperimentResult;
  delta: ComparisonDelta;
}

export interface CompareHarnessesOptions {
  task: CodingTask;
  baseline: HarnessManifest;
  candidate: HarnessManifest;
  /** The harness dimension(s) this comparison intends to vary. Anything else differing fails fast, before any real call. */
  expectedChangedDimensions: HarnessDimension[];
  /** Injected for tests; defaults to the real `runExperiment` (makes real Token Factory calls). */
  runExperimentFn?: typeof defaultRunExperiment;
}

/**
 * Runs the same task under two harness manifests and compares the results.
 * Fails fast (no experiment runs at all) if the manifests differ in
 * anything other than `expectedChangedDimensions` — a controlled experiment
 * requires knowing, in advance, exactly what's being varied.
 */
export async function compareHarnesses(options: CompareHarnessesOptions): Promise<HarnessComparison> {
  validateHarnessManifest(options.baseline);
  validateHarnessManifest(options.candidate);
  const changedDimensions = assertControlledExperiment(options.baseline, options.candidate, options.expectedChangedDimensions);
  const runExperimentFn = options.runExperimentFn ?? defaultRunExperiment;

  // Sequential, not concurrent: keeps failures easy to attribute to one run while this is new.
  const baseline = await runExperimentFn(options.task, options.baseline);
  const candidate = await runExperimentFn(options.task, options.candidate);

  const comparison: HarnessComparison = {
    comparisonId: crypto.randomUUID(),
    taskId: options.task.id,
    changedDimensions,
    baseline,
    candidate,
    delta: computeDelta(baseline, candidate),
  };
  writeComparisonEvidence(comparison);
  return comparison;
}

function computeDelta(baseline: ExperimentResult, candidate: ExperimentResult): ComparisonDelta {
  const changedFilesAdded = candidate.changedFiles.filter((f) => !baseline.changedFiles.includes(f));
  const changedFilesRemoved = baseline.changedFiles.filter((f) => !candidate.changedFiles.includes(f));

  return {
    successChanged: baseline.success !== candidate.success,
    agentTurns: candidate.metrics.agentTurns - baseline.metrics.agentTurns,
    toolCalls: candidate.metrics.toolCalls - baseline.metrics.toolCalls,
    latencyMs: candidate.metrics.latencyMs - baseline.metrics.latencyMs,
    inputTokens: diffOptionalMetric(baseline.metrics.inputTokens, candidate.metrics.inputTokens),
    outputTokens: diffOptionalMetric(baseline.metrics.outputTokens, candidate.metrics.outputTokens),
    totalTokens: diffOptionalMetric(baseline.metrics.totalTokens, candidate.metrics.totalTokens),
    changedFilesAdded,
    changedFilesRemoved,
    behaviorDifferences: computeBehaviorDifferences(baseline, candidate),
  };
}

function diffOptionalMetric(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined || b === undefined ? undefined : b - a;
}

function toolArgsString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pathsForTool(trajectory: AgentTrajectory, toolName: "read_file" | "write_file"): string[] {
  const paths: string[] = [];
  for (const turn of trajectory.turns) {
    for (const call of turn.toolCalls) {
      if (call.name === toolName) paths.push(toolArgsString(call.arguments.path));
    }
  }
  return paths;
}

function commandsRun(trajectory: AgentTrajectory): string[] {
  const commands: string[] = [];
  for (const turn of trajectory.turns) {
    for (const call of turn.toolCalls) {
      if (call.name === "run_command") commands.push(toolArgsString(call.arguments.command));
    }
  }
  return commands;
}

/** Derives behavioral differences directly from each run's own trajectory/evaluation evidence. No model involved. */
export function computeBehaviorDifferences(baseline: ExperimentResult, candidate: ExperimentResult): string[] {
  const diffs: string[] = [];

  for (const toolName of ["read_file", "write_file"] as const) {
    const baselinePaths = new Set(pathsForTool(baseline.evidence.trajectory, toolName));
    const candidatePaths = new Set(pathsForTool(candidate.evidence.trajectory, toolName));
    const verb = toolName === "read_file" ? "read" : "wrote";
    for (const p of baselinePaths) {
      if (!candidatePaths.has(p)) diffs.push(`Baseline ${verb} ${p} that Candidate did not`);
    }
    for (const p of candidatePaths) {
      if (!baselinePaths.has(p)) diffs.push(`Candidate ${verb} ${p} that Baseline did not`);
    }
  }

  const baselineCommands = commandsRun(baseline.evidence.trajectory);
  const candidateCommands = commandsRun(candidate.evidence.trajectory);
  const baselineCommandSet = new Set(baselineCommands);
  const candidateCommandSet = new Set(candidateCommands);
  for (const c of baselineCommandSet) {
    if (!candidateCommandSet.has(c)) diffs.push(`Baseline ran \`${c}\` that Candidate did not`);
  }
  for (const c of candidateCommandSet) {
    if (!baselineCommandSet.has(c)) diffs.push(`Candidate ran \`${c}\` that Baseline did not`);
  }
  if (
    baselineCommands.length === candidateCommands.length &&
    baselineCommandSet.size === candidateCommandSet.size &&
    [...baselineCommandSet].every((c) => candidateCommandSet.has(c)) &&
    baselineCommands.join("|") !== candidateCommands.join("|")
  ) {
    diffs.push(`Baseline ran commands in order: ${baselineCommands.join(", ")}; Candidate ran: ${candidateCommands.join(", ")}`);
  }

  if (baseline.metrics.agentTurns !== candidate.metrics.agentTurns) {
    diffs.push(`Baseline used ${baseline.metrics.agentTurns} agent turns vs Candidate's ${candidate.metrics.agentTurns}`);
  }
  if (baseline.metrics.toolCalls !== candidate.metrics.toolCalls) {
    diffs.push(`Baseline made ${baseline.metrics.toolCalls} tool calls vs Candidate's ${candidate.metrics.toolCalls}`);
  }

  for (const [label, key] of [
    ["Build", "buildPassed"],
    ["Public tests", "publicTestsPassed"],
    ["Hidden tests", "hiddenTestsPassed"],
    ["Relevant tests executed", "relevantTestsExecuted"],
  ] as const) {
    if (baseline.evaluation[key] !== candidate.evaluation[key]) {
      diffs.push(
        `${label} differed: Baseline ${baseline.evaluation[key] ? "yes" : "no"}, Candidate ${candidate.evaluation[key] ? "yes" : "no"}`,
      );
    }
  }

  const addedFiles = candidate.changedFiles.filter((f) => !baseline.changedFiles.includes(f));
  const removedFiles = baseline.changedFiles.filter((f) => !candidate.changedFiles.includes(f));
  if (addedFiles.length > 0) diffs.push(`Candidate changed file(s) Baseline did not: ${addedFiles.join(", ")}`);
  if (removedFiles.length > 0) diffs.push(`Baseline changed file(s) Candidate did not: ${removedFiles.join(", ")}`);

  return diffs;
}
