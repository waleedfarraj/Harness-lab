import "server-only";

import crypto from "node:crypto";
import {
  assertControlledFactorialExperiment,
  buildFactorialExperiment,
  type FactorDefinition,
  type FactorLevel,
} from "../harness/factorial";
import type { HarnessManifest } from "../harness/types";
import { createSandboxRunner } from "../sandbox/runner-config";
import type { SandboxHandle, SandboxRunner } from "../sandbox/types";
import { writeInteractionEvidence } from "./evidence";
import { runExperiment as defaultRunExperiment } from "./run-experiment";
import type { CodingTask, ExperimentResult } from "./types";

export interface FactorialCellOutcome {
  cellId: string;
  factors: Record<string, FactorLevel>;
  result: ExperimentResult;
}

export interface FactorialInteractionResult {
  interactionId: string;
  taskId: string;
  factors: FactorDefinition[];
  cells: FactorialCellOutcome[];
  /** (D - C) - (B - A) over PASS=1/FAIL=0 outcomes. Not a statistic — see module docs. */
  interactionContrast: number;
  interactionObserved: boolean;
  /** Deterministic, evidence-derived sentences. Never LLM-generated. */
  behaviorEvidence: string[];
  /** Set only when `sharedCheckpoint: true` was used. */
  sharedBaseCheckpoint: string | null;
  /** Time to prepare the one shared base (fixture copy + dependency install + git init). Null when not using a shared checkpoint. */
  environmentPreparationMs: number | null;
  /** Per-cell fork time (forkFrom() call only), in cell order. Empty when not using a shared checkpoint. */
  forkTimingsMs: number[];
}

export interface RunFactorialExperimentOptions {
  task: CodingTask;
  factors: [FactorDefinition, FactorDefinition];
  baseManifest: HarnessManifest;
  /** Injected for tests; defaults to the real `runExperiment` (makes real Token Factory calls, once per cell). */
  runExperimentFn?: typeof defaultRunExperiment;
  /** Injected for tests, or to control which runner prepares the shared checkpoint. Defaults to `createSandboxRunner()`. */
  runner?: SandboxRunner;
  /**
   * When true, prepares ONE base sandbox (fixture copy + npm install + git
   * init) and forks all four cells from it instead of rebuilding the
   * environment four times. See `SandboxRunner.forkFrom`.
   */
  sharedCheckpoint?: boolean;
  /** Label passed to the shared base's create() call, for evidence/logs. */
  sharedCheckpointLabel?: string;
  /** Human-readable labels for the four cells, used in behaviorEvidence sentences. Defaults to each cell's id. */
  cellLabels?: Record<"A" | "B" | "C" | "D", string>;
}

function outcome(result: ExperimentResult): 0 | 1 {
  return result.success ? 1 : 0;
}

function findCell(cells: FactorialCellOutcome[], factorAName: string, levelA: FactorLevel, factorBName: string, levelB: FactorLevel): FactorialCellOutcome {
  const cell = cells.find((c) => c.factors[factorAName] === levelA && c.factors[factorBName] === levelB);
  if (!cell) {
    throw new Error(`missing factorial cell for ${factorAName}=${levelA}, ${factorBName}=${levelB}`);
  }
  return cell;
}

/**
 * Runs all four cells of a 2x2 factorial experiment (one real experiment
 * call per cell, sequential) and computes the interaction contrast.
 *
 * IMPORTANT: this is a single run per cell. `interactionContrast` and
 * `interactionObserved` describe what happened in these four specific runs
 * — they are not a statistical claim, and nothing here computes confidence,
 * significance, or causal attribution. That is explicitly out of scope for
 * this milestone.
 */
export async function runFactorialExperiment(options: RunFactorialExperimentOptions): Promise<FactorialInteractionResult> {
  const experiment = buildFactorialExperiment(options.task.id, options.baseManifest, options.factors);
  const [factorA, factorB] = options.factors;
  assertControlledFactorialExperiment(experiment.cells, [factorA.name, factorB.name]);

  const runExperimentFn = options.runExperimentFn ?? defaultRunExperiment;
  const cellOutcomes: FactorialCellOutcome[] = [];

  let sharedBaseCheckpoint: string | null = null;
  let environmentPreparationMs: number | null = null;
  const forkTimingsMs: number[] = [];
  let runner: SandboxRunner | undefined;
  let sharedBase: SandboxHandle | undefined;

  if (options.sharedCheckpoint) {
    runner = options.runner ?? createSandboxRunner();
    const prepStarted = performance.now();
    sharedBase = await runner.create({ label: options.sharedCheckpointLabel ?? `${options.task.id}-shared-base`, fixturePath: options.task.fixturePath });
    environmentPreparationMs = Math.round(performance.now() - prepStarted);
    sharedBaseCheckpoint = sharedBase.checkpoint ?? sharedBase.root ?? sharedBase.id;
  }

  try {
    for (const cell of experiment.cells) {
      let cellOptions: Parameters<typeof runExperimentFn>[2];
      if (options.sharedCheckpoint && runner && sharedBase) {
        const forkStarted = performance.now();
        const sandbox = await runner.forkFrom(sharedBase, cell.id);
        forkTimingsMs.push(Math.round(performance.now() - forkStarted));
        cellOptions = { runner, sandbox };
      }
      const result = await runExperimentFn(options.task, cell.manifest, cellOptions);
      cellOutcomes.push({ cellId: cell.id, factors: cell.factors, result });
    }
  } finally {
    if (options.sharedCheckpoint && runner && sharedBase) {
      await runner.destroy(sharedBase);
    }
  }

  // A = baseline/baseline, B = candidate/baseline, C = baseline/candidate, D = candidate/candidate
  const cellA = findCell(cellOutcomes, factorA.name, "baseline", factorB.name, "baseline");
  const cellB = findCell(cellOutcomes, factorA.name, "candidate", factorB.name, "baseline");
  const cellC = findCell(cellOutcomes, factorA.name, "baseline", factorB.name, "candidate");
  const cellD = findCell(cellOutcomes, factorA.name, "candidate", factorB.name, "candidate");

  const A = outcome(cellA.result);
  const B = outcome(cellB.result);
  const C = outcome(cellC.result);
  const D = outcome(cellD.result);
  const interactionContrast = D - C - (B - A);

  const result: FactorialInteractionResult = {
    interactionId: crypto.randomUUID(),
    taskId: options.task.id,
    factors: options.factors,
    cells: cellOutcomes,
    interactionContrast,
    interactionObserved: interactionContrast !== 0,
    behaviorEvidence: computeFactorialBehaviorEvidence({ A: cellA, B: cellB, C: cellC, D: cellD }, options.cellLabels),
    sharedBaseCheckpoint,
    environmentPreparationMs,
    forkTimingsMs,
  };
  writeInteractionEvidence(result);
  return result;
}

/** Deterministic, trajectory-derived sentences — no model involved. */
export function computeFactorialBehaviorEvidence(
  cells: { A: FactorialCellOutcome; B: FactorialCellOutcome; C: FactorialCellOutcome; D: FactorialCellOutcome },
  labels?: Record<"A" | "B" | "C" | "D", string>,
): string[] {
  const evidence: string[] = [];
  const label: Record<"A" | "B" | "C" | "D", string> = labels ?? {
    A: cells.A.cellId,
    B: cells.B.cellId,
    C: cells.C.cellId,
    D: cells.D.cellId,
  };

  for (const key of ["A", "B", "C", "D"] as const) {
    const { result } = cells[key];
    const detail = result.evidence.trajectory.terminationDetail;
    if (result.terminationReason === "max_turns") {
      evidence.push(`${label[key]} hit the max-turn limit before finishing (used all ${result.metrics.agentTurns} turns)`);
    } else if (result.terminationReason === "completed") {
      evidence.push(`${label[key]} completed naturally in ${result.metrics.agentTurns} turns`);
    } else {
      evidence.push(`${label[key]} stopped early (${result.terminationReason}${detail ? `: ${detail}` : ""})`);
    }
  }

  if (cells.C.result.evaluation.relevantTestsExecuted !== cells.D.result.evaluation.relevantTestsExecuted) {
    evidence.push(
      `Relevant tests executed: ${label.C} ${cells.C.result.evaluation.relevantTestsExecuted ? "yes" : "no"}, ${label.D} ${cells.D.result.evaluation.relevantTestsExecuted ? "yes" : "no"}`,
    );
  }
  if (cells.C.result.success !== cells.D.result.success) {
    evidence.push(`Result differs: ${label.C} ${cells.C.result.success ? "PASS" : "FAIL"}, ${label.D} ${cells.D.result.success ? "PASS" : "FAIL"}`);
  }
  if (cells.A.result.success === cells.B.result.success && cells.A.result.success) {
    evidence.push(`Both baseline-factor-B runs (${label.A}, ${label.B}) passed`);
  }

  // Files read/written and hidden-test outcome differences (evidence-derived, no inference beyond the recorded trajectory).
  for (const [key1, key2] of [
    ["A", "B"],
    ["A", "C"],
    ["C", "D"],
  ] as const) {
    const r1 = cells[key1].result;
    const r2 = cells[key2].result;
    if (r1.evaluation.hiddenTestsPassed !== r2.evaluation.hiddenTestsPassed) {
      evidence.push(
        `Hidden tests differ between ${label[key1]} and ${label[key2]}: ${label[key1]} ${r1.evaluation.hiddenTestsPassed ? "PASS" : "FAIL"}, ${label[key2]} ${r2.evaluation.hiddenTestsPassed ? "PASS" : "FAIL"}`,
      );
    }
  }

  return evidence;
}
