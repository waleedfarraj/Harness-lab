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
import { buildAggregate, decisionCriticality, evaluateAggregateHypotheses, evaluateProvisionalHypotheses, needsMoreRuns } from "./stability";
import { detectFixedMechanisms } from "./mechanism-evidence";
import { explainStableDiagnosis } from "./explain-stable";
import type {
  CellPattern,
  ConfigurationAggregate,
  DiagnosisHypothesis,
  DiagnosisStability,
  ReplicationPolicy,
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
 * Recomputes `isDecisionCritical` on every aggregate against the current
 * CONFIRMED-remaining hypothesis set. Returns new aggregate objects (never
 * mutates in place — every snapshot stays frozen, per the Milestone 7 fix).
 * Called once per planner step, right after hypotheses are re-evaluated.
 */
function markDecisionCritical(aggregates: ConfigurationAggregate[], confirmedRemaining: DiagnosisHypothesis[]): ConfigurationAggregate[] {
  return aggregates.map((a) => ({ ...a, isDecisionCritical: decisionCriticality(a.configuration, confirmedRemaining) > 0 }));
}

/**
 * Milestone 8: the same adaptive stable diagnosis as Milestone 7, corrected
 * for budget allocation. Milestone 7 immediately replicated every newly
 * selected diagnostic configuration to `minRunsPerConfiguration` before
 * moving on — on a 10-run budget with 3 explored configurations, that alone
 * consumed the entire budget (2+2+2+2+2=10) before the planner ever reached
 * the literal isolating contrast needed to finish distinguishing
 * `main_effect:skills` from `interaction:skills×contextPolicy`.
 *
 * Now: baseline/candidate still get their full replication policy up front
 * (section 1 — establishing the regression is real remains non-negotiable).
 * But every new DIAGNOSTIC configuration gets exactly ONE exploratory run
 * first ("provisional" evidence — enough to guide the planner, never enough
 * to decide the final diagnosis). A separate reserved budget
 * (`reservedConfirmationRuns`) is held back specifically to CONFIRM whichever
 * configuration turns out to be decision-critical for the leading
 * hypotheses, rather than being spent broadly replicating everything that
 * was merely explored. See stable-planner.ts's `selectNextAction` for the
 * exact explore-vs-confirm priority order.
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

  /** Baseline/candidate only — full sequential replication up front, unchanged from Milestone 7. */
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
        exploratoryRunCount: 0,
        confirmationRunCount: 0,
        sharedBaseCheckpoint,
        environmentPreparationMs,
      };
      writeStableDiagnosisEvidence(result);
      return result;
    }

    let confirmedHypotheses = evaluateAggregateHypotheses(changedDimensions, aggregates);
    let provisionalHypotheses = evaluateProvisionalHypotheses(changedDimensions, aggregates);
    let currentAggregates = markDecisionCritical(aggregates, confirmedHypotheses.filter((h) => h.status !== "rejected"));
    const steps: StablePlannerStep[] = [];

    while (totalRunsUsed < policy.maxTotalRuns) {
      const confirmedRemaining = confirmedHypotheses.filter((h) => h.status !== "rejected");
      if (confirmedRemaining.length <= 1) break;
      const provisionalRemaining = provisionalHypotheses.filter((h) => h.status !== "rejected");

      const remainingRunBudget = policy.maxTotalRuns - totalRunsUsed;
      const planned = selectNextActionFn(changedDimensions, confirmedRemaining, provisionalRemaining, currentAggregates, policy, remainingRunBudget);
      if (!planned) break;

      const hypothesesBefore = confirmedHypotheses;
      const step = steps.length + 1;
      const label = changedDimensions.map((d) => `${d}=${planned.configuration[d]}`).join(",");
      const manifest = manifestForConfiguration(request.baseline, request.candidate, changedDimensions, planned.configuration, `diagnostic-${planned.bits}`);

      const runResult = await runOnce(planned.bits, label, manifest);
      const runs = runsByBits.get(planned.bits) ?? [];
      const aggregateAfter = buildAggregate(planned.bits, planned.configuration, label, runs, policy.minRunsPerConfiguration);

      const existingIndex = currentAggregates.findIndex((a) => a.configurationVector === planned.bits);
      const updatedAggregates = existingIndex >= 0 ? currentAggregates.map((a, i) => (i === existingIndex ? aggregateAfter : a)) : [...currentAggregates, aggregateAfter];

      confirmedHypotheses = evaluateAggregateHypotheses(changedDimensions, updatedAggregates);
      provisionalHypotheses = evaluateProvisionalHypotheses(changedDimensions, updatedAggregates);
      currentAggregates = markDecisionCritical(updatedAggregates, confirmedHypotheses.filter((h) => h.status !== "rejected"));

      const hypothesesRejected = confirmedHypotheses.filter((h, i) => h.status === "rejected" && hypothesesBefore[i].status !== "rejected");
      const hypothesesRemaining = confirmedHypotheses.filter((h) => h.status !== "rejected");

      steps.push({
        step,
        action: planned.action,
        bits: planned.bits,
        configuration: planned.configuration,
        informationScore: planned.informationScore,
        decisionCriticality: planned.decisionCriticality,
        separatorRarityScore: planned.separatorRarityScore,
        rarePairsSeparated: planned.rarePairsSeparated,
        lookaheadRisk: planned.lookaheadRisk,
        whySelected: planned.whySelected,
        remainingRunBudget,
        reservedConfirmationRuns: policy.reservedConfirmationRuns,
        hypothesesBefore,
        runResult,
        // Use the post-markDecisionCritical snapshot (isDecisionCritical correctly set), not the raw buildAggregate() result.
        aggregateAfter: currentAggregates.find((a) => a.configurationVector === planned.bits)!,
        provisionalHypothesesAfter: provisionalHypotheses,
        confirmedHypothesesAfter: confirmedHypotheses,
        hypothesesRejected,
        hypothesesRemaining,
      });
    }

    const finalAggregates = currentAggregates; // final snapshot, all isDecisionCritical flags up to date
    const diagnosis = classifyDiagnosis(confirmedHypotheses);
    const failingRuns = finalAggregates.flatMap((a) => a.runs.filter((r) => !r.success));
    const fixedMechanismsObserved = [...new Set(failingRuns.flatMap((r) => detectFixedMechanisms(r.evidence.trajectory)))];

    const stability = computeStability(policy, finalAggregates, diagnosis.type);
    const configurationsVisited = finalAggregates.length;
    const configurationsAvoided = exhaustiveConfigurations - configurationsVisited;
    const exploratoryRunCount = steps.filter((s) => s.action === "explore").length;
    const confirmationRunCount = steps.filter((s) => s.action === "confirm").length;

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
      aggregates: finalAggregates,
      diagnosis,
      stability,
      fixedMechanismsObserved,
      mechanismExplanation: null,
      exhaustiveConfigurations,
      configurationsVisited,
      configurationsAvoided,
      searchSpaceReductionPct: Math.round((configurationsAvoided / exhaustiveConfigurations) * 1000) / 10,
      totalCodingRuns: totalRunsUsed,
      exploratoryRunCount,
      confirmationRunCount,
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

/**
 * Exported for direct unit testing (see tests/diagnosis-stable.test.ts).
 * `evidenceQuality` now keys off `evidenceMaturity==="unstable"` (genuinely
 * disagreeing runs), not merely "provisional" (single-run, under-sampled —
 * which is now the EXPECTED resting state for configurations that were
 * explored but turned out not to be decision-critical, and is not itself a
 * quality problem).
 */
export function computeStability(policy: ReplicationPolicy, aggregates: ConfigurationAggregate[], diagnosisType: "main_effect" | "interaction" | "inconclusive"): DiagnosisStability {
  const totalRuns = aggregates.reduce((sum, a) => sum + a.runs.length, 0);
  const repeatedConfigurations = aggregates.filter((a) => a.runs.length > policy.minRunsPerConfiguration).length;
  const unstableConfigurations = aggregates.filter((a) => a.evidenceMaturity === "unstable").map((a) => a.configurationVector);

  let evidenceQuality: DiagnosisStability["evidenceQuality"];
  let reason: string;
  if (diagnosisType === "inconclusive") {
    evidenceQuality = "low";
    reason =
      unstableConfigurations.length > 0
        ? `${unstableConfigurations.length} of ${aggregates.length} configuration(s) remained unstable (genuinely disagreeing runs) across ${totalRuns} total runs (${unstableConfigurations.join(", ")}), which was not enough evidence to uniquely resolve the diagnosis.`
        : `${aggregates.length} configuration(s) were visited across ${totalRuns} total runs, but more than one hypothesis remained consistent with the confirmed evidence collected within budget.`;
  } else if (unstableConfigurations.length === 0) {
    evidenceQuality = "high";
    reason = `Every configuration that was decision-critical for the final diagnosis reached replicated (confirmed) evidence, across ${totalRuns} total runs; no visited configuration was genuinely unstable.`;
  } else {
    evidenceQuality = "moderate";
    reason = `The diagnosis resolved despite ${unstableConfigurations.length} configuration(s) remaining unstable (${unstableConfigurations.join(", ")}) — that instability was not relevant to distinguishing the winning hypothesis.`;
  }

  return { totalRuns, repeatedConfigurations, unstableConfigurations, evidenceQuality, reason };
}

export type { DiagnosisHypothesis };
