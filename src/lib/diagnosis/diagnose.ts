import "server-only";

import crypto from "node:crypto";
import { diffManifests } from "../harness/diff";
import { applyDimension, getDimensionValue } from "../harness/dimension";
import type { HarnessDimension, HarnessManifest } from "../harness/types";
import { validateHarnessManifest } from "../harness/validate";
import { createSandboxRunner } from "../sandbox/runner-config";
import type { SandboxRunner } from "../sandbox/types";
import { writeDiagnosisEvidence } from "../experiments/evidence";
import { runExperiment as defaultRunExperiment } from "../experiments/run-experiment";
import { classifyDiagnosis, selectNextExperiment } from "./planner";
import { evaluateHypotheses, UnsupportedDiagnosisScopeError } from "./hypotheses";
import { detectFixedMechanisms } from "./mechanism-evidence";
import { explainDiagnosis } from "./explain";
import type { CellPattern, DiagnosisEvidence, DiagnosisHypothesis, DiagnosisRequest, DiagnosisResult, DiagnosticExperiment, KnownCell } from "./types";
import type { ExperimentResult } from "../experiments/types";

export interface RunDiagnosisOptions {
  /** Injected for tests, or to control which runner prepares the shared checkpoint. Defaults to `createSandboxRunner()`. */
  runner?: SandboxRunner;
  /** Injected for tests; defaults to the real `runExperiment` (makes real Token Factory calls). */
  runExperimentFn?: typeof defaultRunExperiment;
  /** Injected for tests; defaults to the real `explainDiagnosis` (makes one real Nemotron call). */
  explainFn?: typeof explainDiagnosis;
  /** Skips the mechanism-explanation call entirely (e.g. for offline tests). */
  skipExplanation?: boolean;
  /**
   * Injected for tests only, to exercise the result-cache's duplicate-configuration guard
   * (`DuplicateConfigurationError`). The real `selectNextExperiment` already excludes every
   * `testedBits` entry by construction, so that guard should be unreachable in normal
   * operation — this hook exists so a test can simulate a planner bug and assert the guard
   * actually fires. Defaults to the real `selectNextExperiment`.
   */
  selectNextExperimentFn?: typeof selectNextExperiment;
}

export class DuplicateConfigurationError extends Error {
  constructor(bits: string) {
    super(`internal planner bug: configuration ${bits} was already executed — the result cache must never be asked to re-run a known configuration`);
    this.name = "DuplicateConfigurationError";
  }
}

function cellPatternFor(dimensions: HarnessDimension[], level: "baseline" | "candidate"): CellPattern {
  const pattern = {} as CellPattern;
  for (const dim of dimensions) pattern[dim] = level;
  return pattern;
}

function manifestForConfiguration(
  baseline: HarnessManifest,
  candidate: HarnessManifest,
  dimensions: HarnessDimension[],
  configuration: CellPattern,
  id: string,
): HarnessManifest {
  let manifest = baseline;
  for (const dim of dimensions) {
    const value = configuration[dim] === "baseline" ? getDimensionValue(baseline, dim) : getDimensionValue(candidate, dim);
    manifest = applyDimension(manifest, dim, value);
  }
  const label = dimensions.map((d) => `${d}=${configuration[d]}`).join(",");
  return { ...manifest, id, name: label };
}

/**
 * Given only a baseline harness, a candidate harness, and a task: confirms
 * the regression is real, automatically determines which dimensions
 * changed (1-4 of them), builds the full main-effect + pairwise-interaction
 * hypothesis space generically (never hard-coding a dimension name), and
 * adaptively selects diagnostic experiments — the one that best balances
 * the predicted PASS/FAIL split of the still-possible hypotheses — until
 * exactly one hypothesis remains, the budget runs out, or the evidence is
 * genuinely inconsistent with every hypothesis in the model. Once the
 * classification is fixed, asks Nemotron once to explain the mechanism.
 */
export async function runDiagnosis(request: DiagnosisRequest, options: RunDiagnosisOptions = {}): Promise<DiagnosisResult> {
  validateHarnessManifest(request.baseline);
  validateHarnessManifest(request.candidate);

  const changedDimensions = diffManifests(request.baseline, request.candidate);
  if (changedDimensions.length === 0) {
    throw new Error("baseline and candidate manifests are identical; there is nothing to diagnose");
  }
  if (changedDimensions.length > 4) {
    throw new UnsupportedDiagnosisScopeError(changedDimensions);
  }

  const runExperimentFn = options.runExperimentFn ?? defaultRunExperiment;
  const runner = options.runner ?? createSandboxRunner();
  const selectNextExperimentFn = options.selectNextExperimentFn ?? selectNextExperiment;

  const exhaustiveConfigurations = 2 ** changedDimensions.length;
  const resultCache = new Map<string, ExperimentResult>();

  const prepStarted = performance.now();
  const sharedBase = await runner.create({ label: `${request.task.id}-diagnosis-base`, fixturePath: request.task.fixturePath });
  const environmentPreparationMs = Math.round(performance.now() - prepStarted);
  const sharedBaseCheckpoint = sharedBase.checkpoint ?? sharedBase.root ?? sharedBase.id;

  async function runConfiguration(bits: string, configuration: CellPattern, label: string, manifest: HarnessManifest): Promise<ExperimentResult> {
    if (resultCache.has(bits)) throw new DuplicateConfigurationError(bits);
    const sandbox = await runner.forkFrom(sharedBase, label);
    const result = await runExperimentFn(request.task, manifest, { runner, sandbox });
    resultCache.set(bits, result);
    return result;
  }

  try {
    const baselineBits = "0".repeat(changedDimensions.length);
    const candidateBits = "1".repeat(changedDimensions.length);
    const baselineResult = await runConfiguration(baselineBits, cellPatternFor(changedDimensions, "baseline"), "baseline", request.baseline);
    const candidateResult = await runConfiguration(candidateBits, cellPatternFor(changedDimensions, "candidate"), "candidate", request.candidate);

    const knownCells: KnownCell[] = [
      { label: "baseline", bits: baselineBits, configuration: cellPatternFor(changedDimensions, "baseline"), success: baselineResult.success },
      { label: "candidate", bits: candidateBits, configuration: cellPatternFor(changedDimensions, "candidate"), success: candidateResult.success },
    ];
    const evidence: DiagnosisEvidence[] = knownCells.map((c) => ({ label: c.label, bits: c.bits, configuration: c.configuration, success: c.success }));

    const regressionDetected = baselineResult.success === true && candidateResult.success === false;
    const hypothesisSpace = evaluateHypotheses(changedDimensions, knownCells);

    if (!regressionDetected) {
      const configurationsExecuted = 2;
      const configurationsAvoided = exhaustiveConfigurations - configurationsExecuted;
      const result: DiagnosisResult = {
        diagnosisId: crypto.randomUUID(),
        taskId: request.task.id,
        baselineResult,
        candidateResult,
        regressionDetected: false,
        changedDimensions,
        hypothesisSpace,
        experiments: [],
        diagnosis: {
          type: "inconclusive",
          reason: !baselineResult.success
            ? "baseline itself did not pass; a regression cannot be attributed to the candidate"
            : "candidate did not regress in this live run (stochastic behavior did not reproduce the previously observed failure) — no diagnostic experiments were run",
        },
        evidence,
        fixedMechanismsObserved: [],
        mechanismExplanation: null,
        experimentsRun: 0,
        exhaustiveConfigurations,
        configurationsExecuted,
        configurationsAvoided,
        searchSpaceReductionPct: Math.round((configurationsAvoided / exhaustiveConfigurations) * 1000) / 10,
        sharedBaseCheckpoint,
        environmentPreparationMs,
      };
      writeDiagnosisEvidence(result);
      return result;
    }

    let hypotheses = hypothesisSpace;
    const experiments: DiagnosticExperiment[] = [];

    while (experiments.length < request.maxExperiments) {
      const remaining = hypotheses.filter((h) => h.status !== "rejected");
      if (remaining.length <= 1) break;

      const testedBits = new Set(knownCells.map((c) => c.bits));
      const planned = selectNextExperimentFn(changedDimensions, remaining, testedBits, request.maxExperiments - experiments.length);
      if (!planned) break;

      const hypothesesBefore = hypotheses;
      const step = experiments.length + 1;
      const label = changedDimensions.map((d) => `${d}=${planned.configuration[d]}`).join(",");
      const manifest = manifestForConfiguration(request.baseline, request.candidate, changedDimensions, planned.configuration, `diagnostic-${step}`);

      const result = await runConfiguration(planned.bits, planned.configuration, `diagnostic-${step}`, manifest);

      knownCells.push({ label, bits: planned.bits, configuration: planned.configuration, success: result.success });
      evidence.push({ label, bits: planned.bits, configuration: planned.configuration, success: result.success });

      hypotheses = evaluateHypotheses(changedDimensions, knownCells);
      const hypothesesRejected = hypotheses.filter((h, i) => h.status === "rejected" && hypothesesBefore[i].status !== "rejected");
      const hypothesesRemaining = hypotheses.filter((h) => h.status !== "rejected");

      experiments.push({
        step,
        bits: planned.bits,
        configuration: planned.configuration,
        manifest,
        informationScore: planned.informationScore,
        whySelected: planned.whySelected,
        hypothesesBefore,
        result,
        hypothesesAfter: hypotheses,
        hypothesesRejected,
        hypothesesRemaining,
      });
    }

    const diagnosis = classifyDiagnosis(hypotheses);
    const failingResults = [candidateResult, ...experiments.map((e) => e.result)].filter((r) => !r.success);
    const fixedMechanismsObserved = [...new Set(failingResults.flatMap((r) => detectFixedMechanisms(r.evidence.trajectory)))];

    const configurationsExecuted = 2 + experiments.length;
    const configurationsAvoided = exhaustiveConfigurations - configurationsExecuted;

    const partialResult: DiagnosisResult = {
      diagnosisId: crypto.randomUUID(),
      taskId: request.task.id,
      baselineResult,
      candidateResult,
      regressionDetected: true,
      changedDimensions,
      hypothesisSpace,
      experiments,
      diagnosis,
      evidence,
      fixedMechanismsObserved,
      mechanismExplanation: null,
      experimentsRun: experiments.length,
      exhaustiveConfigurations,
      configurationsExecuted,
      configurationsAvoided,
      searchSpaceReductionPct: Math.round((configurationsAvoided / exhaustiveConfigurations) * 1000) / 10,
      sharedBaseCheckpoint,
      environmentPreparationMs,
    };

    let mechanismExplanation: string | null = null;
    if (!options.skipExplanation) {
      const explainFn = options.explainFn ?? explainDiagnosis;
      mechanismExplanation = await explainFn(partialResult);
    }

    const result: DiagnosisResult = { ...partialResult, mechanismExplanation };
    writeDiagnosisEvidence(result);
    return result;
  } finally {
    await runner.destroy(sharedBase);
  }
}

// re-exported so callers/tests don't need a separate import for a type only used here
export type { DiagnosisHypothesis };
