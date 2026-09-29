import "server-only";

import type { HarnessDimension, HarnessManifest } from "../harness/types";
import type { CodingTask, ExperimentResult } from "../experiments/types";

export interface DiagnosisRequest {
  task: CodingTask;
  baseline: HarnessManifest;
  candidate: HarnessManifest;
  /** Upper bound on additional diagnostic coding-agent runs, beyond the baseline/candidate pair. */
  maxExperiments: number;
}

/**
 * Which level (the baseline or candidate value) each changed dimension is
 * set to in one cell. Only ever indexed by the dimensions that actually
 * changed between baseline and candidate (1-4 of them), so this is
 * intentionally partial over the full `HarnessDimension` set.
 */
export type CellPattern = Partial<Record<HarnessDimension, "baseline" | "candidate">>;

export interface KnownCell {
  label: string;
  /** Bit-vector encoding of `configuration` relative to the stable `changedDimensions` order, e.g. "1010". */
  bits: string;
  configuration: CellPattern;
  success: boolean;
}

export type DiagnosisHypothesisType = "main_effect" | "interaction";
export type DiagnosisHypothesisStatus = "possible" | "supported" | "rejected";

export interface DiagnosisHypothesis {
  id: string;
  factors: HarnessDimension[];
  type: DiagnosisHypothesisType;
  status: DiagnosisHypothesisStatus;
  evidenceFor: string[];
  evidenceAgainst: string[];
}

export interface DiagnosticExperiment {
  step: number;
  bits: string;
  configuration: CellPattern;
  manifest: HarnessManifest;
  /** How well this configuration was predicted to split the (then-)remaining hypotheses. Higher = more balanced = more informative. */
  informationScore: number;
  whySelected: string;
  hypothesesBefore: DiagnosisHypothesis[];
  result: ExperimentResult;
  /** Full hypothesis set, re-evaluated after this experiment's result. */
  hypothesesAfter: DiagnosisHypothesis[];
  /** Hypotheses that were "possible" before this step and are "rejected" after it. */
  hypothesesRejected: DiagnosisHypothesis[];
  /** Hypotheses still "possible" (or "supported") after this step. */
  hypothesesRemaining: DiagnosisHypothesis[];
}

export interface DiagnosisEvidence {
  label: string;
  bits: string;
  configuration: CellPattern;
  success: boolean;
}

export type Diagnosis =
  | { type: "main_effect"; factors: HarnessDimension[] }
  | { type: "interaction"; factors: HarnessDimension[] }
  | { type: "inconclusive"; reason: string };

export interface DiagnosisResult {
  diagnosisId: string;
  taskId: string;
  baselineResult: ExperimentResult;
  candidateResult: ExperimentResult;
  regressionDetected: boolean;
  changedDimensions: HarnessDimension[];
  /** The full candidate hypothesis space (main effects + pairwise interactions) before any diagnostic experiment ran. */
  hypothesisSpace: DiagnosisHypothesis[];
  experiments: DiagnosticExperiment[];
  diagnosis: Diagnosis;
  evidence: DiagnosisEvidence[];
  /** Deterministically detected, unchanged-between-baseline-and-candidate mechanisms observed participating in the failure (e.g. read-dedup) — never a changed causal factor. See diagnosis/mechanism-evidence.ts. */
  fixedMechanismsObserved: string[];
  /** Nemotron's evidence-grounded mechanism explanation. Never used to set `diagnosis` — that's already fixed by the time this runs. Null if not requested. */
  mechanismExplanation: string | null;
  experimentsRun: number;
  exhaustiveConfigurations: number;
  /** experimentsRun + 2 (baseline, candidate). */
  configurationsExecuted: number;
  configurationsAvoided: number;
  searchSpaceReductionPct: number;
  sharedBaseCheckpoint: string | null;
  environmentPreparationMs: number | null;
}

// ---------------------------------------------------------------------------
// Milestone 7: replicated evidence & stability. A configuration's true
// PASS/FAIL behavior is only ever observed through a stochastic coding
// agent — a single run is one `ExperimentResult`; a `ConfigurationAggregate`
// is empirical evidence about a *configuration* built from 2-3 independent
// runs of it. See diagnosis/stability.ts and diagnosis/diagnose-stable.ts.
// ---------------------------------------------------------------------------

/**
 * How confidently repeated runs of one configuration agree.
 *
 * "mostly_pass"/"mostly_fail" mean the observed failureRate is decisively on
 * one side (<=0.33 or >=0.67, see diagnosis/stability.ts); "unstable" means
 * the aggregate is genuinely ambiguous (including: not enough runs were
 * collected to say anything, e.g. runs.length < minRunsPerConfiguration).
 * "unstable" aggregates never contribute PASS/FAIL evidence to hypothesis
 * elimination — they are neither for nor against any hypothesis.
 */
export type StabilityClassification = "mostly_pass" | "mostly_fail" | "unstable";

export interface ReplicationPolicy {
  /** Every configuration gets at least this many runs before it can be classified, budget permitting. */
  minRunsPerConfiguration: number;
  /** A configuration is never run more than this many times, no matter how unstable it looks. */
  maxRunsPerConfiguration: number;
  /** Hard cap on total real coding-agent executions across the whole diagnosis (baseline + candidate + every diagnostic run/replicate). Never exceeded automatically. */
  maxTotalRuns: number;
}

export interface StableDiagnosisRequest {
  task: CodingTask;
  baseline: HarnessManifest;
  candidate: HarnessManifest;
  replication: ReplicationPolicy;
}

/** Empirical, replicated evidence about one harness configuration. Individual run evidence is preserved in `runs`, never discarded. */
export interface ConfigurationAggregate {
  configurationVector: string;
  configuration: CellPattern;
  label: string;
  runs: ExperimentResult[];
  passCount: number;
  failCount: number;
  /** passCount / runs.length. An observed frequency, not a probability or confidence level. */
  passRate: number;
  /** failCount / runs.length. An observed frequency, not a probability or confidence level. */
  failureRate: number;
  terminationReasons: Record<string, number>;
  meanInputTokens: number;
  meanOutputTokens: number;
  meanLatencyMs: number;
  stability: StabilityClassification;
}

export type PlannerAction = "new_configuration" | "replicate";

export interface StablePlannerStep {
  step: number;
  action: PlannerAction;
  bits: string;
  configuration: CellPattern;
  /** How well this configuration (if resolved decisively) was predicted to split the then-remaining hypotheses, or (for a replicate) why resolving its instability still matters. */
  informationScore: number;
  whySelected: string;
  hypothesesBefore: DiagnosisHypothesis[];
  /** The one real coding-agent run this step performed. */
  runResult: ExperimentResult;
  /** This configuration's full aggregate, recomputed to include `runResult`. */
  aggregateAfter: ConfigurationAggregate;
  hypothesesAfter: DiagnosisHypothesis[];
  hypothesesRejected: DiagnosisHypothesis[];
  hypothesesRemaining: DiagnosisHypothesis[];
}

/**
 * Hackathon-facing evidence quality, not a formal statistical confidence
 * level. "high" means every configuration relevant to the final diagnosis
 * resolved decisively (mostly_pass or mostly_fail); "moderate" means the
 * diagnosis resolved despite some unrelated instability; "low" means the
 * diagnosis itself is inconclusive because of unresolved instability.
 */
export interface DiagnosisStability {
  totalRuns: number;
  /** Configurations that needed more than `minRunsPerConfiguration` runs (i.e. their first `minRuns` runs disagreed). */
  repeatedConfigurations: number;
  /** Bit-vectors of every configuration whose final stability is "unstable". */
  unstableConfigurations: string[];
  evidenceQuality: "low" | "moderate" | "high";
  reason: string;
}

export interface StableDiagnosisResult {
  diagnosisId: string;
  taskId: string;
  changedDimensions: HarnessDimension[];
  hypothesisSpace: DiagnosisHypothesis[];
  replicationPolicy: ReplicationPolicy;
  baselineAggregate: ConfigurationAggregate;
  candidateAggregate: ConfigurationAggregate;
  regressionDetected: boolean;
  steps: StablePlannerStep[];
  /** Every configuration visited, including baseline and candidate, each with its full run history. */
  aggregates: ConfigurationAggregate[];
  diagnosis: Diagnosis;
  stability: DiagnosisStability;
  fixedMechanismsObserved: string[];
  mechanismExplanation: string | null;
  exhaustiveConfigurations: number;
  /** Distinct configurations (bit-vectors) visited at least once. */
  configurationsVisited: number;
  configurationsAvoided: number;
  searchSpaceReductionPct: number;
  /** Every real coding-agent execution, including every replicate. */
  totalCodingRuns: number;
  /** Of `totalCodingRuns`, how many were replicate runs (i.e. not a configuration's first run). */
  replicateRunCount: number;
  sharedBaseCheckpoint: string | null;
  environmentPreparationMs: number | null;
}
