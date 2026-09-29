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
import type {
  CellPattern,
  DiagnosisEvidence,
  DiagnosisRequest,
  DiagnosisResult,
  DiagnosticExperiment,
  KnownCell,
} from "./types";

export interface RunDiagnosisOptions {
  /** Injected for tests, or to control which runner prepares the shared checkpoint. Defaults to `createSandboxRunner()`. */
  runner?: SandboxRunner;
  /** Injected for tests; defaults to the real `runExperiment` (makes real Token Factory calls). */
  runExperimentFn?: typeof defaultRunExperiment;
  /** Injected for tests; defaults to the real `explainDiagnosis` (makes one real Nemotron call). */
  explainFn?: typeof explainDiagnosis;
  /** Skips the mechanism-explanation call entirely (e.g. for offline tests). */
  skipExplanation?: boolean;
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
 * changed, plans and runs the minimum diagnostic experiments needed to
 * distinguish "one dimension alone" from "the interaction between them",
 * and (once the deterministic classification is fixed) asks Nemotron once
 * to explain the mechanism. The caller never tells HarnessLab which
 * dimension is the cause.
 */
export async function runDiagnosis(request: DiagnosisRequest, options: RunDiagnosisOptions = {}): Promise<DiagnosisResult> {
  validateHarnessManifest(request.baseline);
  validateHarnessManifest(request.candidate);

  const changedDimensions = diffManifests(request.baseline, request.candidate);
  if (changedDimensions.length === 0) {
    throw new Error("baseline and candidate manifests are identical; there is nothing to diagnose");
  }
  if (changedDimensions.length > 2) {
    throw new UnsupportedDiagnosisScopeError(changedDimensions);
  }

  const runExperimentFn = options.runExperimentFn ?? defaultRunExperiment;
  const runner = options.runner ?? createSandboxRunner();

  const prepStarted = performance.now();
  const sharedBase = await runner.create({ label: `${request.task.id}-diagnosis-base`, fixturePath: request.task.fixturePath });
  const environmentPreparationMs = Math.round(performance.now() - prepStarted);
  const sharedBaseCheckpoint = sharedBase.checkpoint ?? sharedBase.root ?? sharedBase.id;

  try {
    const baselineSandbox = await runner.forkFrom(sharedBase, "baseline");
    const baselineResult = await runExperimentFn(request.task, request.baseline, { runner, sandbox: baselineSandbox });

    const candidateSandbox = await runner.forkFrom(sharedBase, "candidate");
    const candidateResult = await runExperimentFn(request.task, request.candidate, { runner, sandbox: candidateSandbox });

    const knownCells: KnownCell[] = [
      { label: "baseline", configuration: cellPatternFor(changedDimensions, "baseline"), success: baselineResult.success },
      { label: "candidate", configuration: cellPatternFor(changedDimensions, "candidate"), success: candidateResult.success },
    ];
    const evidence: DiagnosisEvidence[] = knownCells.map((c) => ({ label: c.label, configuration: c.configuration, success: c.success }));

    const regressionDetected = baselineResult.success === true && candidateResult.success === false;

    if (!regressionDetected) {
      const result: DiagnosisResult = {
        diagnosisId: crypto.randomUUID(),
        taskId: request.task.id,
        baselineResult,
        candidateResult,
        regressionDetected: false,
        changedDimensions,
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
        exhaustiveConfigurations: 2 ** changedDimensions.length,
        sharedBaseCheckpoint,
        environmentPreparationMs,
      };
      writeDiagnosisEvidence(result);
      return result;
    }

    let hypotheses = evaluateHypotheses(changedDimensions, knownCells);
    let diagnosis = classifyDiagnosis(hypotheses);
    const experiments: DiagnosticExperiment[] = [];

    while (diagnosis.type === "inconclusive" && experiments.length < request.maxExperiments) {
      const planned = selectNextExperiment(changedDimensions, knownCells, request.maxExperiments - experiments.length);
      if (!planned) break;

      const hypothesesBefore = hypotheses;
      const label = changedDimensions.map((d) => `${d}=${planned.configuration[d]}`).join(",");
      const manifest = manifestForConfiguration(request.baseline, request.candidate, changedDimensions, planned.configuration, `diagnostic-${experiments.length + 1}`);

      const sandbox = await runner.forkFrom(sharedBase, `diagnostic-${experiments.length + 1}`);
      const result = await runExperimentFn(request.task, manifest, { runner, sandbox });

      knownCells.push({ label, configuration: planned.configuration, success: result.success });
      evidence.push({ label, configuration: planned.configuration, success: result.success });

      hypotheses = evaluateHypotheses(changedDimensions, knownCells);
      diagnosis = classifyDiagnosis(hypotheses);

      experiments.push({
        id: `experiment-${experiments.length + 1}`,
        configuration: planned.configuration,
        manifest,
        whySelected: planned.whySelected,
        hypothesesBefore,
        result,
        hypothesesAfter: hypotheses,
      });
    }

    const failingResults = [candidateResult, ...experiments.map((e) => e.result)].filter((r) => !r.success);
    const fixedMechanismsObserved = [...new Set(failingResults.flatMap((r) => detectFixedMechanisms(r.evidence.trajectory)))];

    const partialResult: DiagnosisResult = {
      diagnosisId: crypto.randomUUID(),
      taskId: request.task.id,
      baselineResult,
      candidateResult,
      regressionDetected: true,
      changedDimensions,
      experiments,
      diagnosis,
      evidence,
      fixedMechanismsObserved,
      mechanismExplanation: null,
      experimentsRun: experiments.length,
      exhaustiveConfigurations: 2 ** changedDimensions.length,
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
