import "server-only";

import crypto from "node:crypto";
import { diffManifests } from "../harness/diff";
import type { HarnessManifest } from "../harness/types";
import { validateHarnessManifest } from "../harness/validate";
import { createSandboxRunner } from "../sandbox/runner-config";
import type { SandboxHandle, SandboxRunner } from "../sandbox/types";
import { writeStableDiagnosisEvidence } from "../experiments/evidence";
import { runExperiment as defaultRunExperiment } from "../experiments/run-experiment";
import type { ExperimentResult } from "../experiments/types";
import { cellPatternFor, manifestForConfiguration } from "./diagnose";
import { buildHypothesisSpace, UnsupportedDiagnosisScopeError } from "./hypotheses";
import { classifyDiagnosis } from "./planner";
import { selectNextAction } from "./stable-planner";
import { buildAggregate, evaluateAggregateHypotheses, needsMoreRuns } from "./stability";
import { detectFixedMechanisms } from "./mechanism-evidence";
import { explainStableDiagnosis } from "./explain-stable";
import type {
  CellPattern,
  ConfigurationAggregate,
  DiagnosisHypothesis,
  DiagnosisStability,
  StableDiagnosisRequest,
  StableDiagnosisResult,
  StablePlannerStep,
} from "./types";

export interface RunStableDiagnosisOptions {
  runner?: SandboxRunner;
  runExperimentFn?: typeof defaultRunExperiment;
  explainFn?: typeof explainStableDiagnosis;
  skipExplanation?: boolean;
  /** Injected for tests only — see the analogous hook in diagnose.ts. Defaults to the real `selectNextAction`. */
  selectNextActionFn?: typeof selectNextAction;
}

export class RunBudgetExhaustedError extends Error {
  constructor() {
    super("internal bug: attempted a coding-agent run after maxTotalRuns was already exhausted — the caller must check the budget before every run");
    this.name = "RunBudgetExhaustedError";
  }
}

/**
 * Milestone 7: the same adaptive diagnosis as diagnose.ts, but every
 * configuration is backed by 2-3 independent runs instead of 1. Baseline and
 * candidate are each resolved via the sequential replication policy before
 * regression is even evaluated; the adaptive loop then chooses, before every
 * additional run, whether to replicate an unstable configuration or try a
 * new one. Never fabricates statistical confidence — an aggregate that
 * cannot be resolved within `maxRunsPerConfiguration` stays "unstable" and
 * is honestly excluded from hypothesis elimination.
 */
export async function runStableDiagnosis(request: StableDiagnosisRequest, options: RunStableDiagnosisOptions = {}): Promise<StableDiagnosisResult> {
  validateHarnessManifest(request.baseline);
  validateHarnessManifest(request.candidate);

  const changedDimensions = diffManifests(request.baseline, request.candidate);
  if (changedDimensions.length === 0) {
    throw new Error("baseline and candidate manifests are identical; there is nothing to diagnose");
  }
  if (changedDimensions.length > 4) {
    throw new UnsupportedDiagnosisScopeError(changedDimensions);
  }

  const policy = request.replication;
  const runExperimentFn = options.runExperimentFn ?? defaultRunExperiment;
  const runner = options.runner ?? createSandboxRunner();
  const selectNextActionFn = options.selectNextActionFn ?? selectNextAction;

  const exhaustiveConfigurations = 2 ** changedDimensions.length;

  const prepStarted = performance.now();
  const sharedBase = await runner.create({ label: `${request.task.id}-stable-diagnosis-base`, fixturePath: request.task.fixturePath });
  const environmentPreparationMs = Math.round(performance.now() - prepStarted);
  const sharedBaseCheckpoint = sharedBase.checkpoint ?? sharedBase.root ?? sharedBase.id;

  let totalRunsUsed = 0;
  const runsByBits = new Map<string, ExperimentResult[]>();

  async function runOnce(bits: string, label: string, manifest: HarnessManifest): Promise<ExperimentResult> {
    if (totalRunsUsed >= policy.maxTotalRuns) throw new RunBudgetExhaustedError();
    const sandbox: SandboxHandle = await runner.forkFrom(sharedBase, `${label}-run${(runsByBits.get(bits)?.length ?? 0) + 1}`);
    const result = await runExperimentFn(request.task, manifest, { runner, sandbox });
    totalRunsUsed += 1;
    const existing = runsByBits.get(bits) ?? [];
    existing.push(result);
    runsByBits.set(bits, existing);
    return result;
  }

  async function resolveConfiguration(bits: string, configuration: CellPattern, label: string, manifest: HarnessManifest): Promise<ConfigurationAggregate> {
    let runs = runsByBits.get(bits) ?? [];
    while (totalRunsUsed < policy.maxTotalRuns) {
      const passCount = runs.filter((r) => r.success).length;
      const failCount = runs.length - passCount;
      if (!needsMoreRuns(passCount, failCount, policy.minRunsPerConfiguration, policy.maxRunsPerConfiguration)) break;
      await runOnce(bits, label, manifest);
      runs = runsByBits.get(bits) ?? [];
    }
    return buildAggregate(bits, configuration, label, runs, policy.minRunsPerConfiguration);
  }

  try {
    const baselineBits = "0".repeat(changedDimensions.length);
    const candidateBits = "1".repeat(changedDimensions.length);

    const baselineAggregate = await resolveConfiguration(baselineBits, cellPatternFor(changedDimensions, "baseline"), "baseline", request.baseline);
    const candidateAggregate = await resolveConfiguration(candidateBits, cellPatternFor(changedDimensions, "candidate"), "candidate", request.candidate);

    const aggregates: ConfigurationAggregate[] = [baselineAggregate, candidateAggregate];
    const hypothesisSpace = buildHypothesisSpace(changedDimensions);

    const regressionDetected = baselineAggregate.stability === "mostly_pass" && candidateAggregate.stability === "mostly_fail";

    if (!regressionDetected) {
      const stability = computeStability(policy, aggregates, "inconclusive");
      const configurationsVisited = aggregates.length;
      const configurationsAvoided = exhaustiveConfigurations - configurationsVisited;
      const result: StableDiagnosisResult = {
        diagnosisId: crypto.randomUUID(),
        taskId: request.task.id,
        changedDimensions,
        hypothesisSpace,
        replicationPolicy: policy,
        baselineAggregate,
        candidateAggregate,
        regressionDetected: false,
        steps: [],
        aggregates,
        diagnosis: {
          type: "inconclusive",
          reason: reasonForNoRegression(baselineAggregate, candidateAggregate),
        },
        stability,
        fixedMechanismsObserved: [],
        mechanismExplanation: null,
        exhaustiveConfigurations,
        configurationsVisited,
        configurationsAvoided,
        searchSpaceReductionPct: Math.round((configurationsAvoided / exhaustiveConfigurations) * 1000) / 10,
        totalCodingRuns: totalRunsUsed,
        replicateRunCount: totalRunsUsed - configurationsVisited,
        sharedBaseCheckpoint,
        environmentPreparationMs,
      };
      writeStableDiagnosisEvidence(result);
      return result;
    }

    let hypotheses = evaluateAggregateHypotheses(changedDimensions, aggregates);
    const steps: StablePlannerStep[] = [];

    while (totalRunsUsed < policy.maxTotalRuns) {
      const remaining = hypotheses.filter((h) => h.status !== "rejected");
      if (remaining.length <= 1) break;

      const planned = selectNextActionFn(changedDimensions, remaining, aggregates, policy, policy.maxTotalRuns - totalRunsUsed);
      if (!planned) break;

      const hypothesesBefore = hypotheses;
      const step = steps.length + 1;
      const label = changedDimensions.map((d) => `${d}=${planned.configuration[d]}`).join(",");
      const manifest = manifestForConfiguration(request.baseline, request.candidate, changedDimensions, planned.configuration, `diagnostic-${planned.bits}`);

      const runResult = await runOnce(planned.bits, label, manifest);
      const runs = runsByBits.get(planned.bits) ?? [];
      const aggregateAfter = buildAggregate(planned.bits, planned.configuration, label, runs, policy.minRunsPerConfiguration);

      const existingIndex = aggregates.findIndex((a) => a.configurationVector === planned.bits);
      if (existingIndex >= 0) aggregates[existingIndex] = aggregateAfter;
      else aggregates.push(aggregateAfter);

      hypotheses = evaluateAggregateHypotheses(changedDimensions, aggregates);
      const hypothesesRejected = hypotheses.filter((h, i) => h.status === "rejected" && hypothesesBefore[i].status !== "rejected");
      const hypothesesRemaining = hypotheses.filter((h) => h.status !== "rejected");

      steps.push({
        step,
        action: planned.action,
        bits: planned.bits,
        configuration: planned.configuration,
        informationScore: planned.informationScore,
        whySelected: planned.whySelected,
        hypothesesBefore,
        runResult,
        aggregateAfter,
        hypothesesAfter: hypotheses,
        hypothesesRejected,
        hypothesesRemaining,
      });
    }

    const diagnosis = classifyDiagnosis(hypotheses);
    const failingRuns = aggregates.flatMap((a) => a.runs.filter((r) => !r.success));
    const fixedMechanismsObserved = [...new Set(failingRuns.flatMap((r) => detectFixedMechanisms(r.evidence.trajectory)))];

    const stability = computeStability(policy, aggregates, diagnosis.type);
    const configurationsVisited = aggregates.length;
    const configurationsAvoided = exhaustiveConfigurations - configurationsVisited;

    const partial: StableDiagnosisResult = {
      diagnosisId: crypto.randomUUID(),
      taskId: request.task.id,
      changedDimensions,
      hypothesisSpace,
      replicationPolicy: policy,
      baselineAggregate,
      candidateAggregate,
      regressionDetected: true,
      steps,
      aggregates,
      diagnosis,
      stability,
      fixedMechanismsObserved,
      mechanismExplanation: null,
      exhaustiveConfigurations,
      configurationsVisited,
      configurationsAvoided,
      searchSpaceReductionPct: Math.round((configurationsAvoided / exhaustiveConfigurations) * 1000) / 10,
      totalCodingRuns: totalRunsUsed,
      replicateRunCount: totalRunsUsed - configurationsVisited,
      sharedBaseCheckpoint,
      environmentPreparationMs,
    };

    let mechanismExplanation: string | null = null;
    if (!options.skipExplanation) {
      const explainFn = options.explainFn ?? explainStableDiagnosis;
      mechanismExplanation = await explainFn(partial);
    }

    const result: StableDiagnosisResult = { ...partial, mechanismExplanation };
    writeStableDiagnosisEvidence(result);
    return result;
  } finally {
    await runner.destroy(sharedBase);
  }
}

function reasonForNoRegression(baseline: ConfigurationAggregate, candidate: ConfigurationAggregate): string {
  if (baseline.stability !== "mostly_pass") {
    return `baseline itself did not resolve to mostly_pass (${baseline.stability}, failure rate ${(baseline.failureRate * 100).toFixed(1)}% over ${baseline.runs.length} runs); a regression cannot be attributed to the candidate`;
  }
  return `candidate did not resolve to mostly_fail in this live run (${candidate.stability}, failure rate ${(candidate.failureRate * 100).toFixed(1)}% over ${candidate.runs.length} runs) — stochastic behavior did not reproduce the previously observed failure`;
}

/** Exported for direct unit testing (see tests/diagnosis-stable.test.ts) — evidence-quality tiers are easiest to verify against synthetic aggregate arrays, not just through a full end-to-end multi-step run. */
export function computeStability(policy: import("./types").ReplicationPolicy, aggregates: ConfigurationAggregate[], diagnosisType: "main_effect" | "interaction" | "inconclusive"): DiagnosisStability {
  const totalRuns = aggregates.reduce((sum, a) => sum + a.runs.length, 0);
  const repeatedConfigurations = aggregates.filter((a) => a.runs.length > policy.minRunsPerConfiguration).length;
  const unstableConfigurations = aggregates.filter((a) => a.stability === "unstable").map((a) => a.configurationVector);

  let evidenceQuality: DiagnosisStability["evidenceQuality"];
  let reason: string;
  if (diagnosisType === "inconclusive") {
    evidenceQuality = "low";
    reason =
      unstableConfigurations.length > 0
        ? `${unstableConfigurations.length} of ${aggregates.length} configuration(s) remained unstable across ${totalRuns} total runs (${unstableConfigurations.join(", ")}), which was not enough evidence to uniquely resolve the diagnosis.`
        : `${aggregates.length} configuration(s) resolved decisively across ${totalRuns} total runs, but more than one hypothesis remained consistent with that evidence.`;
  } else if (unstableConfigurations.length === 0) {
    evidenceQuality = "high";
    reason = `Every one of ${aggregates.length} visited configurations resolved decisively (mostly_pass or mostly_fail) across ${totalRuns} total runs.`;
  } else {
    evidenceQuality = "moderate";
    reason = `The diagnosis resolved despite ${unstableConfigurations.length} configuration(s) remaining unstable (${unstableConfigurations.join(", ")}) — that instability was not relevant to distinguishing the winning hypothesis.`;
  }

  return { totalRuns, repeatedConfigurations, unstableConfigurations, evidenceQuality, reason };
}

export type { DiagnosisHypothesis };
