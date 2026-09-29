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
 * changed between baseline and candidate (1 or 2 of them), so this is
 * intentionally partial over the full `HarnessDimension` set.
 */
export type CellPattern = Partial<Record<HarnessDimension, "baseline" | "candidate">>;

export interface KnownCell {
  label: string;
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
  id: string;
  configuration: CellPattern;
  manifest: HarnessManifest;
  whySelected: string;
  hypothesesBefore: DiagnosisHypothesis[];
  result: ExperimentResult;
  hypothesesAfter: DiagnosisHypothesis[];
}

export interface DiagnosisEvidence {
  label: string;
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
  experiments: DiagnosticExperiment[];
  diagnosis: Diagnosis;
  evidence: DiagnosisEvidence[];
  /** Deterministically detected, unchanged-between-baseline-and-candidate mechanisms observed participating in the failure (e.g. read-dedup) — never a changed causal factor. See diagnosis/mechanism-evidence.ts. */
  fixedMechanismsObserved: string[];
  /** Nemotron's evidence-grounded mechanism explanation. Never used to set `diagnosis` — that's already fixed by the time this runs. Null if not requested. */
  mechanismExplanation: string | null;
  experimentsRun: number;
  exhaustiveConfigurations: number;
  sharedBaseCheckpoint: string | null;
  environmentPreparationMs: number | null;
}
