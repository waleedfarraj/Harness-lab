/**
 * Adapter from HarnessLab's frozen diagnosis backend types
 * (`src/lib/diagnosis/types.ts`) to the UI-facing `DiagnosisViewModel`
 * (`./types.ts`). Pure and synchronous: no filesystem access, no network
 * calls, no "server-only" import of its own (everything from the backend is
 * pulled in via `import type`, which is erased at build time). Supports both
 * the current replicated-evidence schema (`StableDiagnosisResult`, Milestones
 * 7-9) and the earlier single-run schema (`DiagnosisResult`, Milestone 6) so
 * real evidence recorded before replication tracking existed can still be
 * rendered honestly — see `schemaSource` on the result.
 *
 * Never fabricates a value: a field the source evidence doesn't have becomes
 * `null` (or a documented default), never a guess.
 */
import type { AgentTrajectory } from "../agent/types";
import type {
  DiagnosisHypothesis,
  DiagnosisResult,
  DiagnosisStability,
  StableDiagnosisResult,
  StablePlannerStep,
  CellPattern,
  ConfigurationAggregate,
} from "../diagnosis/types";
import type { ExperimentResult } from "../experiments/types";
import type { HarnessDimension, HarnessManifest } from "../harness/types";
import type {
  AggregateViewModel,
  CellStatus,
  CompactionEventViewModel,
  DiagnosisOutcomeViewModel,
  DiagnosisViewModel,
  DimensionChangeViewModel,
  GridCellViewModel,
  HarnessSummaryViewModel,
  HypothesisViewModel,
  PlannerStepViewModel,
  RunEvidenceViewModel,
  RunnerKind,
  ToolCallViewModel,
} from "./types";

export interface DiagnosisViewModelContext {
  /** Falls back to `raw.taskId` when omitted. */
  taskTitle?: string;
  taskInstruction?: string;
  /** Needed to show literal harness values (skill content, system prompt text, maxTurns). Without it, dimension changes still render — just as "baseline"/"candidate" labels instead of literal values. */
  baselineManifest?: HarnessManifest;
  candidateManifest?: HarnessManifest;
}

const DIMENSION_LABELS: Record<HarnessDimension, string> = {
  model: "Model",
  systemPrompt: "System Prompt",
  "execution.maxTurns": "Max Turns",
  skills: "Skill",
  contextPolicy: "Context Policy",
};

export function dimensionLabel(dimension: string): string {
  return DIMENSION_LABELS[dimension as HarnessDimension] ?? dimension;
}

function hypothesisLabel(factors: string[]): string {
  return factors.map(dimensionLabel).join(" × ");
}

function toHypothesisViewModel(h: DiagnosisHypothesis): HypothesisViewModel {
  return { id: h.id, label: hypothesisLabel(h.factors), type: h.type, status: h.status };
}

const DEDUP_MARKER = /^\(unchanged since your last read of/;
const MAX_DIFF_PREVIEW_CHARS = 4000;
const MAX_TOOL_CALL_LIST = 60;
const MAX_SUMMARY_CHARS = 220;

/** Every `read_file`/`write_file`/`run_command` call from a trajectory, deduplicated, in first-seen order. */
function extractFileAndCommandActivity(trajectory: AgentTrajectory): { filesRead: string[]; filesWritten: string[]; commandsExecuted: string[] } {
  const filesRead: string[] = [];
  const filesWritten: string[] = [];
  const commandsExecuted: string[] = [];
  for (const turn of trajectory.turns) {
    for (const call of turn.toolCalls) {
      const path = typeof call.arguments.path === "string" ? call.arguments.path : null;
      const command = typeof call.arguments.command === "string" ? call.arguments.command : null;
      if (call.name === "read_file" && path && !filesRead.includes(path)) filesRead.push(path);
      if (call.name === "write_file" && path && !filesWritten.includes(path)) filesWritten.push(path);
      if (call.name === "run_command" && command && !commandsExecuted.includes(command)) commandsExecuted.push(command);
    }
  }
  return { filesRead, filesWritten, commandsExecuted };
}

function extractCompactionEvents(trajectory: AgentTrajectory): CompactionEventViewModel[] {
  const events: CompactionEventViewModel[] = [];
  for (const turn of trajectory.turns) {
    for (const event of turn.request.newCompactionEvents) {
      events.push({ turn: turn.turn, toolName: event.toolName, identifier: event.identifier, originalChars: event.originalChars, compactedChars: event.compactedChars });
    }
  }
  return events;
}

function countDedupHits(trajectory: AgentTrajectory): number {
  let count = 0;
  for (const turn of trajectory.turns) {
    for (const call of turn.toolCalls) {
      if (DEDUP_MARKER.test(call.resultSummary)) count += 1;
    }
  }
  return count;
}

function extractToolCalls(trajectory: AgentTrajectory): ToolCallViewModel[] {
  const calls: ToolCallViewModel[] = [];
  for (const turn of trajectory.turns) {
    for (const call of turn.toolCalls) {
      calls.push({ turn: turn.turn, name: call.name, ok: call.ok, summary: call.resultSummary.slice(0, MAX_SUMMARY_CHARS) });
    }
  }
  return calls.slice(0, MAX_TOOL_CALL_LIST);
}

function runEvidenceFromResult(result: ExperimentResult): RunEvidenceViewModel {
  const trajectory = result.evidence.trajectory;
  const { filesRead, filesWritten, commandsExecuted } = extractFileAndCommandActivity(trajectory);
  const diff = result.evidence.diff ?? "";
  return {
    runId: result.runId,
    success: result.success,
    terminationReason: result.terminationReason,
    terminationDetail: trajectory.terminationDetail,
    evaluation: result.evaluation,
    changedFiles: result.changedFiles,
    metrics: {
      agentTurns: result.metrics.agentTurns,
      toolCalls: result.metrics.toolCalls,
      latencyMs: result.metrics.latencyMs,
      inputTokens: result.metrics.inputTokens ?? null,
      outputTokens: result.metrics.outputTokens ?? null,
      totalTokens: result.metrics.totalTokens ?? null,
    },
    turnCount: trajectory.turns.length,
    filesRead,
    filesWritten,
    commandsExecuted,
    toolCalls: extractToolCalls(trajectory),
    dedupHitCount: countDedupHits(trajectory),
    compactionEvents: extractCompactionEvents(trajectory),
    diffPreview: diff.length > 0 ? diff.slice(0, MAX_DIFF_PREVIEW_CHARS) : null,
    diffTruncated: diff.length > MAX_DIFF_PREVIEW_CHARS,
    sandboxHandleId: result.evidence.sandbox.handleId,
    runnerKind: result.evidence.sandbox.runner,
  };
}

function classifySingleRun(success: boolean): "mostly_pass" | "mostly_fail" {
  return success ? "mostly_pass" : "mostly_fail";
}

/** Builds an `AggregateViewModel` for a legacy (single-run) configuration — used for Milestone 6 evidence, which has no replication concept. */
function aggregateFromSingleRun(bits: string, label: string, cellPattern: CellPattern, result: ExperimentResult): AggregateViewModel {
  const run = runEvidenceFromResult(result);
  return {
    bits,
    label,
    cellPattern,
    runs: [run],
    passCount: result.success ? 1 : 0,
    failCount: result.success ? 0 : 1,
    failureRatePct: result.success ? 0 : 100,
    stability: classifySingleRun(result.success),
    evidenceMaturity: null,
    isDecisionCritical: false,
    meanInputTokens: result.metrics.inputTokens ?? 0,
    meanOutputTokens: result.metrics.outputTokens ?? 0,
    meanLatencyMs: result.metrics.latencyMs,
  };
}

function aggregateFromConfigurationAggregate(agg: ConfigurationAggregate): AggregateViewModel {
  return {
    bits: agg.configurationVector,
    label: agg.label,
    cellPattern: agg.configuration,
    runs: agg.runs.map(runEvidenceFromResult),
    passCount: agg.passCount,
    failCount: agg.failCount,
    failureRatePct: Math.round(agg.failureRate * 1000) / 10,
    stability: agg.stability,
    evidenceMaturity: agg.evidenceMaturity,
    isDecisionCritical: agg.isDecisionCritical,
    meanInputTokens: Math.round(agg.meanInputTokens),
    meanOutputTokens: Math.round(agg.meanOutputTokens),
    meanLatencyMs: Math.round(agg.meanLatencyMs),
  };
}

function statusFromStability(stability: "mostly_pass" | "mostly_fail" | "unstable"): CellStatus {
  if (stability === "mostly_pass") return "pass";
  if (stability === "mostly_fail") return "fail";
  return "unstable";
}

function buildConfigurationGrid(dimensions: HarnessDimension[], aggregates: AggregateViewModel[], stepsByBits: Map<string, number>): GridCellViewModel[] {
  const n = dimensions.length;
  const total = 2 ** n;
  const allZeros = "0".repeat(n);
  const allOnes = "1".repeat(n);
  const byBits = new Map(aggregates.map((a) => [a.bits, a]));

  const cells: GridCellViewModel[] = [];
  for (let i = 0; i < total; i++) {
    const bits = i.toString(2).padStart(n, "0");
    const isBaseline = bits === allZeros;
    const isCandidate = bits === allOnes;
    const agg = byBits.get(bits);
    const status: CellStatus = isBaseline ? "baseline" : isCandidate ? "candidate" : agg ? statusFromStability(agg.stability) : "not_tested";
    cells.push({ bits, status, stepIndex: stepsByBits.get(bits) ?? null, isBaseline, isCandidate });
  }
  return cells;
}

function dimensionValue(manifest: HarnessManifest | undefined, dimension: HarnessDimension): string | null {
  if (!manifest) return null;
  switch (dimension) {
    case "model":
      return manifest.model;
    case "systemPrompt":
      return manifest.systemPrompt;
    case "execution.maxTurns":
      return String(manifest.execution.maxTurns);
    case "skills":
      return manifest.skills.map((s) => s.id).join(", ") || "(none)";
    case "contextPolicy":
      return manifest.contextPolicy;
  }
}

function skillContent(manifest: HarnessManifest | undefined): string | null {
  if (!manifest || manifest.skills.length === 0) return null;
  return manifest.skills.map((s) => s.content).join("\n\n");
}

function shortValue(dimension: HarnessDimension, full: string): string {
  if (dimension === "systemPrompt") return full.length > 70 ? `${full.slice(0, 70)}…` : full;
  return full;
}

function buildDimensionChanges(changedDimensions: HarnessDimension[], ctx: DiagnosisViewModelContext): DimensionChangeViewModel[] {
  return changedDimensions.map((dimension) => {
    const baselineFull = dimensionValue(ctx.baselineManifest, dimension);
    const candidateFull = dimensionValue(ctx.candidateManifest, dimension);
    const baselineDetail = dimension === "skills" ? skillContent(ctx.baselineManifest) : dimension === "systemPrompt" ? baselineFull : null;
    const candidateDetail = dimension === "skills" ? skillContent(ctx.candidateManifest) : dimension === "systemPrompt" ? candidateFull : null;
    return {
      dimension,
      label: dimensionLabel(dimension),
      baselineValue: baselineFull ? shortValue(dimension, baselineFull) : "baseline",
      candidateValue: candidateFull ? shortValue(dimension, candidateFull) : "candidate",
      baselineDetail,
      candidateDetail,
    };
  });
}

function harnessSummary(manifest: HarnessManifest | undefined): HarnessSummaryViewModel | null {
  if (!manifest) return null;
  const skill = manifest.skills[0];
  return {
    model: manifest.model,
    skillLabel: skill?.id ?? "(none)",
    skillContent: skill?.content ?? null,
    contextPolicy: manifest.contextPolicy,
    systemPromptShort: shortValue("systemPrompt", manifest.systemPrompt),
    systemPromptFull: manifest.systemPrompt,
    maxTurns: manifest.execution.maxTurns,
  };
}

function truncateId(id: string | null | undefined, headLen = 8, tailLen = 4): string | null {
  if (!id) return null;
  if (id.length <= headLen + tailLen + 1) return id;
  return `${id.slice(0, headLen)}…${id.slice(-tailLen)}`;
}

function firstBaseImage(runs: ExperimentResult[]): string | null {
  for (const r of runs) {
    const metadata = r.evidence.sandbox.metadata;
    const baseImage = metadata?.baseImage;
    if (typeof baseImage === "string") return baseImage;
  }
  return null;
}

function firstRunnerKind(runs: ExperimentResult[]): RunnerKind {
  return runs[0]?.evidence.sandbox.runner ?? "local";
}

function outcomeViewModel(diagnosis: StableDiagnosisResult["diagnosis"] | DiagnosisResult["diagnosis"], hypothesisSpace: DiagnosisHypothesis[]): DiagnosisOutcomeViewModel {
  if (diagnosis.type === "interaction") {
    const labels = diagnosis.factors.map(dimensionLabel);
    return { type: "interaction", factorLabels: labels, headline: labels.join(" × ") };
  }
  if (diagnosis.type === "main_effect") {
    const labels = diagnosis.factors.map(dimensionLabel);
    return { type: "main_effect", factorLabels: labels, headline: labels.join(", ") };
  }
  const remaining = hypothesisSpace.filter((h) => h.status !== "rejected").map(toHypothesisViewModel);
  return { type: "inconclusive", reason: diagnosis.reason, remainingHypotheses: remaining };
}

function isStableResult(raw: StableDiagnosisResult | DiagnosisResult): raw is StableDiagnosisResult {
  return "steps" in raw && "aggregates" in raw;
}

function fromStable(raw: StableDiagnosisResult, ctx: DiagnosisViewModelContext): DiagnosisViewModel {
  const baselineAgg = aggregateFromConfigurationAggregate(raw.baselineAggregate);
  const candidateAgg = aggregateFromConfigurationAggregate(raw.candidateAggregate);

  const stepsByBits = new Map(raw.steps.map((s, i) => [s.bits, i]));
  const aggregates = raw.aggregates.map(aggregateFromConfigurationAggregate);
  const grid = buildConfigurationGrid(raw.changedDimensions, aggregates, stepsByBits);

  const steps: PlannerStepViewModel[] = raw.steps.map((step: StablePlannerStep) => ({
    step: step.step,
    action: step.action,
    bits: step.bits,
    cellPattern: step.configuration,
    changedFromBaselineLabels: raw.changedDimensions.filter((d) => step.configuration[d] === "candidate").map(dimensionLabel),
    whySelected: step.whySelected,
    resultPass: step.runResult.success,
    hypothesesEliminated: step.hypothesesRejected.map(toHypothesisViewModel),
    hypothesesRemaining: step.hypothesesRemaining.map(toHypothesisViewModel),
    aggregateAfter: aggregateFromConfigurationAggregate(step.aggregateAfter),
    technical: {
      informationScore: step.informationScore,
      decisionCriticality: step.decisionCriticality ?? null,
      separatorRarityScore: step.separatorRarityScore ?? null,
      rarePairsSeparated: step.rarePairsSeparated ?? null,
      lookaheadRisk: step.lookaheadRisk ?? null,
      remainingRunBudget: step.remainingRunBudget ?? null,
      reservedConfirmationRuns: step.reservedConfirmationRuns ?? null,
    },
  }));

  const allRuns = raw.aggregates.flatMap((a) => a.runs);
  const stability: DiagnosisStability = raw.stability;

  return {
    schemaSource: "stable",
    diagnosisId: raw.diagnosisId,
    taskId: raw.taskId,
    taskTitle: ctx.taskTitle ?? raw.taskId,
    taskInstruction: ctx.taskInstruction ?? null,
    model: ctx.baselineManifest?.model ?? ctx.candidateManifest?.model ?? null,
    baseline: { result: raw.baselineAggregate.stability === "mostly_fail" ? "FAIL" : "PASS", aggregate: baselineAgg, harness: harnessSummary(ctx.baselineManifest) },
    candidate: { result: raw.candidateAggregate.stability === "mostly_fail" ? "FAIL" : "PASS", aggregate: candidateAgg, harness: harnessSummary(ctx.candidateManifest) },
    regressionDetected: raw.regressionDetected,
    dimensionChanges: buildDimensionChanges(raw.changedDimensions, ctx),
    exhaustiveConfigurations: raw.exhaustiveConfigurations,
    configurationsVisited: raw.configurationsVisited,
    configurationsAvoided: raw.configurationsAvoided,
    searchSpaceReductionPct: raw.searchSpaceReductionPct,
    configurationGrid: grid,
    hypothesisSpace: raw.hypothesisSpace.map(toHypothesisViewModel),
    steps,
    diagnosis: outcomeViewModel(raw.diagnosis, raw.hypothesisSpace),
    stability: { evidenceQuality: stability.evidenceQuality, totalRuns: stability.totalRuns, unstableConfigurationBits: stability.unstableConfigurations, reason: stability.reason },
    mechanismExplanation: raw.mechanismExplanation,
    fixedMechanismsObserved: raw.fixedMechanismsObserved,
    sandbox: {
      runnerKind: firstRunnerKind(allRuns),
      sharedBaseCheckpointTruncated: truncateId(raw.sharedBaseCheckpoint),
      baseImage: firstBaseImage(allRuns),
      totalCodingRuns: raw.totalCodingRuns,
      exploratoryRunCount: raw.exploratoryRunCount ?? null,
      confirmationRunCount: raw.confirmationRunCount ?? null,
      environmentPreparationMs: raw.environmentPreparationMs,
      nemotronUsed: raw.mechanismExplanation !== null,
    },
  };
}

function fromLegacy(raw: DiagnosisResult, ctx: DiagnosisViewModelContext): DiagnosisViewModel {
  const n = raw.changedDimensions.length;
  const baselineBits = "0".repeat(n);
  const candidateBits = "1".repeat(n);
  const baselinePattern: CellPattern = {};
  const candidatePattern: CellPattern = {};
  for (const d of raw.changedDimensions) {
    baselinePattern[d] = "baseline";
    candidatePattern[d] = "candidate";
  }

  const baselineAgg = aggregateFromSingleRun(baselineBits, "baseline", baselinePattern, raw.baselineResult);
  const candidateAgg = aggregateFromSingleRun(candidateBits, "candidate", candidatePattern, raw.candidateResult);

  const stepsByBits = new Map(raw.experiments.map((e, i) => [e.bits, i]));
  const aggregates = [baselineAgg, candidateAgg, ...raw.experiments.map((e) => aggregateFromSingleRun(e.bits, e.manifest.name, e.configuration, e.result))];
  const grid = buildConfigurationGrid(raw.changedDimensions, aggregates, stepsByBits);

  const steps: PlannerStepViewModel[] = raw.experiments.map((exp) => ({
    step: exp.step,
    action: "explore",
    bits: exp.bits,
    cellPattern: exp.configuration,
    changedFromBaselineLabels: raw.changedDimensions.filter((d) => exp.configuration[d] === "candidate").map(dimensionLabel),
    whySelected: exp.whySelected,
    resultPass: exp.result.success,
    hypothesesEliminated: exp.hypothesesRejected.map(toHypothesisViewModel),
    hypothesesRemaining: exp.hypothesesRemaining.map(toHypothesisViewModel),
    aggregateAfter: aggregateFromSingleRun(exp.bits, exp.manifest.name, exp.configuration, exp.result),
    technical: {
      informationScore: exp.informationScore,
      decisionCriticality: null,
      separatorRarityScore: null,
      rarePairsSeparated: null,
      lookaheadRisk: null,
      remainingRunBudget: null,
      reservedConfirmationRuns: null,
    },
  }));

  const allRuns = [raw.baselineResult, raw.candidateResult, ...raw.experiments.map((e) => e.result)];

  return {
    schemaSource: "legacy",
    diagnosisId: raw.diagnosisId,
    taskId: raw.taskId,
    taskTitle: ctx.taskTitle ?? raw.taskId,
    taskInstruction: ctx.taskInstruction ?? null,
    model: ctx.baselineManifest?.model ?? ctx.candidateManifest?.model ?? null,
    baseline: { result: raw.baselineResult.success ? "PASS" : "FAIL", aggregate: baselineAgg, harness: harnessSummary(ctx.baselineManifest) },
    candidate: { result: raw.candidateResult.success ? "PASS" : "FAIL", aggregate: candidateAgg, harness: harnessSummary(ctx.candidateManifest) },
    regressionDetected: raw.regressionDetected,
    dimensionChanges: buildDimensionChanges(raw.changedDimensions, ctx),
    exhaustiveConfigurations: raw.exhaustiveConfigurations,
    configurationsVisited: raw.configurationsExecuted,
    configurationsAvoided: raw.configurationsAvoided,
    searchSpaceReductionPct: raw.searchSpaceReductionPct,
    configurationGrid: grid,
    hypothesisSpace: raw.hypothesisSpace.map(toHypothesisViewModel),
    steps,
    diagnosis: outcomeViewModel(raw.diagnosis, raw.hypothesisSpace),
    stability: null,
    mechanismExplanation: raw.mechanismExplanation,
    fixedMechanismsObserved: raw.fixedMechanismsObserved,
    sandbox: {
      runnerKind: firstRunnerKind(allRuns),
      sharedBaseCheckpointTruncated: truncateId(raw.sharedBaseCheckpoint),
      baseImage: firstBaseImage(allRuns),
      totalCodingRuns: raw.configurationsExecuted,
      exploratoryRunCount: null,
      confirmationRunCount: null,
      environmentPreparationMs: raw.environmentPreparationMs,
      nemotronUsed: raw.mechanismExplanation !== null,
    },
  };
}

export function toDiagnosisViewModel(raw: StableDiagnosisResult | DiagnosisResult, ctx: DiagnosisViewModelContext = {}): DiagnosisViewModel {
  return isStableResult(raw) ? fromStable(raw, ctx) : fromLegacy(raw, ctx);
}
