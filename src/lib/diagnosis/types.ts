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
  /** Baseline/candidate get at least this many runs before regression is evaluated; a decisive diagnostic contrast needs this many CONSISTENT runs to count as "replicated". */
  minRunsPerConfiguration: number;
  /** A configuration is never run more than this many times, no matter how unstable it looks. */
  maxRunsPerConfiguration: number;
  /** Hard cap on total real coding-agent executions across the whole diagnosis (baseline + candidate + every exploratory/confirmation run). Never exceeded automatically. */
  maxTotalRuns: number;
  /**
   * Milestone 8: runs held back from exploration, spent only on confirming
   * a decision-critical contrast once one is identified. Exploration alone
   * must never be allowed to consume the whole budget and leave nothing for
   * confirming the leading hypothesis — see diagnose-stable.ts's planner.
   */
  reservedConfirmationRuns: number;
}

export interface StableDiagnosisRequest {
  task: CodingTask;
  baseline: HarnessManifest;
  candidate: HarnessManifest;
  replication: ReplicationPolicy;
}

/**
 * Milestone 8: how much a configuration's evidence can be trusted, distinct
 * from *which way* it leans (that's still `stability`). "provisional" means
 * exactly one run exists — usable to guide exploration, never to decide a
 * final diagnosis. "replicated" means >= minRunsPerConfiguration runs that
 * agree (stability is mostly_pass/mostly_fail). "unstable" means >=
 * minRunsPerConfiguration runs were collected and they genuinely don't
 * agree (stability is "unstable") — this is different from "provisional":
 * it's not under-sampled, it's actually inconsistent.
 */
export type EvidenceMaturity = "provisional" | "replicated" | "unstable";

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
  /** Direction classification. Still requires >= minRunsPerConfiguration to say mostly_pass/mostly_fail — see stability.ts. */
  stability: StabilityClassification;
  /** Confidence tier — see `EvidenceMaturity`'s doc comment. */
  evidenceMaturity: EvidenceMaturity;
  /** Whether this configuration currently separates at least one pair of the CONFIRMED-remaining hypotheses — i.e. whether replicating it further could actually change the official diagnosis. Recomputed every planner step; see diagnose-stable.ts's `markDecisionCritical`. */
  isDecisionCritical: boolean;
}

/** Milestone 8: "explore" tries a never-before-tested configuration; "confirm" adds a run to an already-tested, decision-critical configuration to raise it from "provisional"/"unstable" to "replicated". */
export type PlannerAction = "explore" | "confirm";

export interface StablePlannerStep {
  step: number;
  action: PlannerAction;
  bits: string;
  configuration: CellPattern;
  /** Balanced-split information score against the CONFIRMED-remaining hypotheses (same metric as Milestone 7). */
  informationScore: number;
  /** How many pairs of the PROVISIONAL-remaining ("currently leading") hypotheses this configuration separates — see diagnose-stable.ts's `decisionCriticality`. Drives "confirm" targeting and explore prioritization once few hypotheses remain plausible. */
  decisionCriticality: number;
  /** Milestone 9: sum of 1/remainingSeparatorCount over every CONFIRMED-remaining hypothesis pair this configuration separates — see stability.ts's `computeSeparatorRarity`. 0 for "confirm" actions (rarity is an exploration-selection concept; an already-tested configuration's rarity was already spent when it was first explored). */
  separatorRarityScore: number;
  /** How many of the pairs counted in `separatorRarityScore` had at most `RARE_SEPARATOR_THRESHOLD` remaining separating configurations at selection time. */
  rarePairsSeparated: number;
  /** Milestone 9's bounded one-step look-ahead: true if EITHER possible outcome (PASS or FAIL) of this run would leave >1 hypothesis remaining with no untested configuration able to separate any pair among them, or no budget left to run one. Always false for "confirm" actions. Informational — it deprioritizes, but never outright forbids, a risky exploratory pick. */
  lookaheadRisk: boolean;
  whySelected: string;
  /** Run budget remaining BEFORE this step's run. */
  remainingRunBudget: number;
  reservedConfirmationRuns: number;
  /** CONFIRMED-remaining hypotheses before this step (what the official diagnosis would say right now). */
  hypothesesBefore: DiagnosisHypothesis[];
  /** The one real coding-agent run this step performed. */
  runResult: ExperimentResult;
  /** This configuration's full aggregate, recomputed to include `runResult`. A frozen snapshot — never mutated by a later step. */
  aggregateAfter: ConfigurationAggregate;
  /** Hypotheses still alive using ALL evidence including single-run "provisional" observations — the current best guess, narrower than confirmedHypothesesAfter. */
  provisionalHypothesesAfter: DiagnosisHypothesis[];
  /** Hypotheses still alive using only REPLICATED (confirmed) evidence — what the official diagnosis is based on. */
  confirmedHypothesesAfter: DiagnosisHypothesis[];
  /** Hypotheses newly CONFIRMED-rejected by this step (i.e. present in confirmedHypothesesAfter's rejected set but not before). */
  hypothesesRejected: DiagnosisHypothesis[];
  /** confirmedHypothesesAfter filtered to non-rejected — kept for continuity with Milestone 7's field name. */
  hypothesesRemaining: DiagnosisHypothesis[];
}

/**
 * Hackathon-facing evidence quality, not a formal statistical confidence
 * level. "high" means every configuration that was ever decision-critical
 * reached "replicated" maturity; "moderate" means the diagnosis resolved
 * despite some unrelated (non-decision-critical) instability; "low" means
 * the diagnosis itself is inconclusive.
 */
export interface DiagnosisStability {
  totalRuns: number;
  /** Configurations that needed more than `minRunsPerConfiguration` runs (i.e. their first `minRuns` runs disagreed). */
  repeatedConfigurations: number;
  /** Bit-vectors of every configuration whose final evidenceMaturity is "unstable" (genuinely disagreeing runs — not merely "provisional"/under-sampled). */
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
  /** Every real coding-agent execution, including baseline/candidate replication and every diagnostic explore/confirm run. */
  totalCodingRuns: number;
  /** Of the diagnostic (non-baseline/candidate) `steps`, how many had action "explore" (a never-before-tested configuration). */
  exploratoryRunCount: number;
  /** Of the diagnostic `steps`, how many had action "confirm" (replicating an already-tested, decision-critical configuration). */
  confirmationRunCount: number;
  sharedBaseCheckpoint: string | null;
  environmentPreparationMs: number | null;
}
