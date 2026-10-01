/**
 * UI-facing shapes for the diagnosis page. Deliberately decoupled from
 * `diagnosis/types.ts`: this is what components render, not what the
 * diagnosis engine produces. See `diagnosis-view-model.ts` for the adapter
 * that maps one to the other. No `server-only` import here on purpose — this
 * is a plain, serializable shape safe to pass from a Server Component to a
 * Client Component.
 */

export type CellStatus = "baseline" | "candidate" | "pass" | "fail" | "unstable" | "not_tested";
export type PlannerAction = "explore" | "confirm";
export type StabilityClassification = "mostly_pass" | "mostly_fail" | "unstable";
export type EvidenceMaturity = "provisional" | "replicated" | "unstable";
export type EvidenceQuality = "low" | "moderate" | "high";
export type RunnerKind = "local" | "token-factory";

export interface DimensionChangeViewModel {
  dimension: string;
  label: string;
  baselineValue: string;
  candidateValue: string;
  baselineDetail: string | null;
  candidateDetail: string | null;
}

export interface HypothesisViewModel {
  id: string;
  label: string;
  type: "main_effect" | "interaction";
  status: "possible" | "supported" | "rejected";
}

export interface CompactionEventViewModel {
  turn: number;
  toolName: string;
  identifier: string;
  originalChars: number;
  compactedChars: number;
}

export interface ToolCallViewModel {
  turn: number;
  name: string;
  ok: boolean;
  summary: string;
}

export interface RunEvidenceViewModel {
  runId: string;
  success: boolean;
  terminationReason: string;
  terminationDetail: string | null;
  evaluation: { buildPassed: boolean; publicTestsPassed: boolean; hiddenTestsPassed: boolean; relevantTestsExecuted: boolean };
  changedFiles: string[];
  metrics: { agentTurns: number; toolCalls: number; latencyMs: number; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  turnCount: number;
  filesRead: string[];
  filesWritten: string[];
  commandsExecuted: string[];
  toolCalls: ToolCallViewModel[];
  dedupHitCount: number;
  compactionEvents: CompactionEventViewModel[];
  diffPreview: string | null;
  diffTruncated: boolean;
  sandboxHandleId: string;
  runnerKind: RunnerKind;
}

export interface AggregateViewModel {
  bits: string;
  label: string;
  cellPattern: Record<string, "baseline" | "candidate" | undefined>;
  runs: RunEvidenceViewModel[];
  passCount: number;
  failCount: number;
  failureRatePct: number;
  stability: StabilityClassification;
  evidenceMaturity: EvidenceMaturity | null;
  isDecisionCritical: boolean;
  meanInputTokens: number;
  meanOutputTokens: number;
  meanLatencyMs: number;
}

export interface PlannerStepViewModel {
  step: number;
  action: PlannerAction;
  bits: string;
  cellPattern: Record<string, "baseline" | "candidate" | undefined>;
  changedFromBaselineLabels: string[];
  whySelected: string;
  resultPass: boolean;
  hypothesesEliminated: HypothesisViewModel[];
  hypothesesRemaining: HypothesisViewModel[];
  aggregateAfter: AggregateViewModel;
  technical: {
    informationScore: number;
    decisionCriticality: number | null;
    separatorRarityScore: number | null;
    rarePairsSeparated: number | null;
    lookaheadRisk: boolean | null;
    remainingRunBudget: number | null;
    reservedConfirmationRuns: number | null;
  };
}

export type DiagnosisOutcomeViewModel =
  | { type: "interaction"; factorLabels: string[]; headline: string }
  | { type: "main_effect"; factorLabels: string[]; headline: string }
  | { type: "inconclusive"; reason: string; remainingHypotheses: HypothesisViewModel[] };

export interface GridCellViewModel {
  bits: string;
  status: CellStatus;
  stepIndex: number | null;
  isBaseline: boolean;
  isCandidate: boolean;
}

export interface HarnessSummaryViewModel {
  model: string;
  skillLabel: string;
  skillContent: string | null;
  contextPolicy: string;
  systemPromptShort: string;
  systemPromptFull: string;
  maxTurns: number;
}

export interface DiagnosisViewModel {
  schemaSource: "stable" | "legacy";
  diagnosisId: string;
  taskId: string;
  taskTitle: string;
  taskInstruction: string | null;
  model: string | null;
  baseline: { result: "PASS" | "FAIL"; aggregate: AggregateViewModel; harness: HarnessSummaryViewModel | null };
  candidate: { result: "PASS" | "FAIL"; aggregate: AggregateViewModel; harness: HarnessSummaryViewModel | null };
  regressionDetected: boolean;
  dimensionChanges: DimensionChangeViewModel[];
  exhaustiveConfigurations: number;
  configurationsVisited: number;
  configurationsAvoided: number;
  searchSpaceReductionPct: number;
  configurationGrid: GridCellViewModel[];
  hypothesisSpace: HypothesisViewModel[];
  steps: PlannerStepViewModel[];
  diagnosis: DiagnosisOutcomeViewModel;
  stability: { evidenceQuality: EvidenceQuality; totalRuns: number; unstableConfigurationBits: string[]; reason: string } | null;
  mechanismExplanation: string | null;
  fixedMechanismsObserved: string[];
  sandbox: {
    runnerKind: RunnerKind;
    sharedBaseCheckpointTruncated: string | null;
    baseImage: string | null;
    totalCodingRuns: number;
    exploratoryRunCount: number | null;
    confirmationRunCount: number | null;
    environmentPreparationMs: number | null;
    nemotronUsed: boolean;
  };
}
