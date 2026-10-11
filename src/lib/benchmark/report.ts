import "server-only";

import type { HarnessDimension } from "../harness/types";
import type { StableDiagnosisResult } from "../diagnosis/types";
import type { BenchmarkCase, ExpectedShape } from "./types";

/**
 * Section 10 of the controlled-regression benchmark brief: a seeded case
 * only counts as qualifying "hero" evidence if every one of these holds.
 * Reads only fields already present on the real `StableDiagnosisResult` —
 * computes no new diagnosis-engine metric and feeds nothing back into the
 * (frozen) diagnosis engine. "No secret leakage" (criterion 9) is a
 * structural property of the call that produced `result`, not something
 * derivable from the result itself — see tests/benchmark-anti-leakage.test.ts,
 * which is this criterion's actual enforcement; it is recorded here as
 * always-true by construction (the planner/`DiagnosisRequest` type has no
 * field to leak `expectedShape`/`expectedFactors` into).
 */
export function evaluateHeroQualification(result: StableDiagnosisResult): { qualified: boolean; failures: string[] } {
  const failures: string[] = [];

  const isCurrentSchema = typeof result.stability !== "undefined" && typeof result.baselineAggregate !== "undefined" && typeof result.candidateAggregate !== "undefined";
  if (!isCurrentSchema) failures.push("not the current StableDiagnosisResult schema");
  if (result.baselineAggregate.stability !== "mostly_pass") failures.push(`baseline did not classify mostly_pass (got ${result.baselineAggregate.stability})`);
  if (result.candidateAggregate.stability !== "mostly_fail") failures.push(`candidate did not classify mostly_fail (got ${result.candidateAggregate.stability})`);
  if (!result.regressionDetected) failures.push("no regression detected");
  if (result.diagnosis.type === "inconclusive") failures.push(`diagnosis is inconclusive, not decisive (${result.diagnosis.reason})`);
  if (result.diagnosis.type !== "main_effect" && result.diagnosis.type !== "interaction") failures.push("diagnosis is neither main_effect nor interaction");

  const decisionCritical = result.aggregates.filter((a) => a.isDecisionCritical);
  const unreplicatedDecisionCritical = decisionCritical.filter((a) => a.evidenceMaturity !== "replicated");
  if (unreplicatedDecisionCritical.length > 0) {
    failures.push(`decisive contrast(s) lack replicated evidence: ${unreplicatedDecisionCritical.map((a) => a.configurationVector).join(", ")}`);
  }

  const lastStep = result.steps[result.steps.length - 1];
  const finalHypotheses = lastStep ? lastStep.confirmedHypothesesAfter : result.hypothesisSpace;
  const unsupported = finalHypotheses.filter((h) => h.status === "possible");
  if (unsupported.length > 0) failures.push(`unsupported hypothesis/hypotheses remain: ${unsupported.map((h) => h.id).join(", ")}`);

  const missingDeterministicEvidence = result.aggregates.some((a) => a.runs.some((r) => typeof r.evaluation?.hiddenTestsPassed === "undefined"));
  if (missingDeterministicEvidence) failures.push("at least one run is missing deterministic evaluator evidence");

  if (!result.sharedBaseCheckpoint) failures.push("no shared Nebius checkpoint recorded for this diagnosis");

  return { qualified: failures.length === 0, failures };
}

/**
 * Honest-disagreement check only (section 12): does the real diagnosis's
 * factor set match the case's pre-stated `expectedFactors`? Metadata-only,
 * computed after the fact — never a claim fed back into the engine.
 */
export function heroFactorsMatchExpectation(result: StableDiagnosisResult, expectedFactors: HarnessDimension[] | undefined): boolean | null {
  if (!expectedFactors) return null;
  if (result.diagnosis.type !== "main_effect" && result.diagnosis.type !== "interaction") return false;
  const actual = [...result.diagnosis.factors].sort();
  const expected = [...expectedFactors].sort();
  return actual.length === expected.length && actual.every((f, i) => f === expected[i]);
}

/**
 * Per-case fields are read directly off the real `StableDiagnosisResult` —
 * nothing here is computed by a new metric the frozen diagnosis engine
 * doesn't already produce (section 7 of the benchmark brief).
 */
export interface BenchmarkCaseReport {
  caseId: string;
  name: string;
  taskId: string;
  expectedShape: ExpectedShape;
  reusedExistingEvidence: boolean;
  baselineStability: string;
  candidateStability: string;
  changedDimensions: string[];
  exhaustiveConfigurations: number;
  configurationsVisited: number;
  totalCodingRuns: number;
  diagnosis: StableDiagnosisResult["diagnosis"];
  evidenceQuality: string;
  evidenceQualityReason: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCodingAgentLatencyMs: number;
  sandboxSetupMs: number | null;
  deterministicEvaluatorOutcome: {
    baselineHiddenTestsPassRate: number;
    candidateHiddenTestsPassRate: number;
  };
  mechanismExplanationAvailable: boolean;
  diagnosisId: string;
  diagnosisFilePath: string;
  /** Evaluation metadata passthrough from BenchmarkCase — see types.ts. Never read by the diagnosis engine. */
  controlledSeeded: boolean;
  expectedFactors: HarnessDimension[] | null;
  heroCaseId: string | null;
  /** Section 10 qualification — see `evaluateHeroQualification`. Computed for every case, but only meaningful as a "hero" claim for `controlledSeeded` ones. */
  heroQualified: boolean;
  heroQualificationFailures: string[];
  /** Honest disagreement check against the pre-stated `expectedFactors` — null when the case didn't state one, or the diagnosis wasn't decisive. */
  factorsMatchExpectation: boolean | null;
}

export function buildCaseReport(bc: BenchmarkCase, result: StableDiagnosisResult, reusedExistingEvidence: boolean, diagnosisFilePath: string): BenchmarkCaseReport {
  const allRuns = result.aggregates.flatMap((a) => a.runs);
  const totalInputTokens = allRuns.reduce((sum, r) => sum + (r.metrics.inputTokens ?? 0), 0);
  const totalOutputTokens = allRuns.reduce((sum, r) => sum + (r.metrics.outputTokens ?? 0), 0);
  const totalCodingAgentLatencyMs = allRuns.reduce((sum, r) => sum + r.metrics.latencyMs, 0);

  const hiddenPassRate = (runs: typeof allRuns) => (runs.length === 0 ? 0 : runs.filter((r) => r.evaluation.hiddenTestsPassed).length / runs.length);

  const heroQualification = evaluateHeroQualification(result);

  return {
    caseId: bc.id,
    name: bc.name,
    taskId: result.taskId,
    expectedShape: bc.expectedShape,
    reusedExistingEvidence,
    baselineStability: result.baselineAggregate.stability,
    candidateStability: result.candidateAggregate.stability,
    changedDimensions: result.changedDimensions,
    exhaustiveConfigurations: result.exhaustiveConfigurations,
    configurationsVisited: result.configurationsVisited,
    totalCodingRuns: result.totalCodingRuns,
    diagnosis: result.diagnosis,
    evidenceQuality: result.stability.evidenceQuality,
    evidenceQualityReason: result.stability.reason,
    totalInputTokens,
    totalOutputTokens,
    totalCodingAgentLatencyMs,
    sandboxSetupMs: result.environmentPreparationMs,
    deterministicEvaluatorOutcome: {
      baselineHiddenTestsPassRate: hiddenPassRate(result.baselineAggregate.runs),
      candidateHiddenTestsPassRate: hiddenPassRate(result.candidateAggregate.runs),
    },
    mechanismExplanationAvailable: result.mechanismExplanation !== null,
    diagnosisId: result.diagnosisId,
    diagnosisFilePath,
    controlledSeeded: bc.controlledSeeded ?? false,
    expectedFactors: bc.expectedFactors ?? null,
    heroCaseId: bc.heroCaseId ?? null,
    heroQualified: heroQualification.qualified,
    heroQualificationFailures: heroQualification.failures,
    factorsMatchExpectation: heroFactorsMatchExpectation(result, bc.expectedFactors),
  };
}

export interface AggregateBenchmarkTotals {
  casesRun: number;
  regressionsReproduced: number;
  decisiveDiagnoses: number;
  decisiveDiagnosesAmongRegressions: number;
  correctlyInconclusive: number;
  falseConfidentDiagnoses: number;
  averageSearchSpaceReductionPct: number;
  totalCodingAgentExecutions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface AggregateBenchmarkReport {
  generatedAt: string;
  /** Natural/exploratory cases only (section 15) — `controlledSeeded` cases are reported separately and excluded here so a deliberately seeded fault isn't counted as an independent natural accuracy sample. */
  cases: BenchmarkCaseReport[];
  totals: AggregateBenchmarkTotals;
  /** Controlled seeded case(s) (fault injection) — reported on their own, with explicit hero qualification, never folded into `totals`. */
  controlledSeededCases: BenchmarkCaseReport[];
}

function computeTotals(caseReports: BenchmarkCaseReport[]): AggregateBenchmarkTotals {
  const regressions = caseReports.filter((c) => c.baselineStability === "mostly_pass" && c.candidateStability === "mostly_fail");
  const decisive = caseReports.filter((c) => c.diagnosis.type === "main_effect" || c.diagnosis.type === "interaction");
  const decisiveAmongRegressions = regressions.filter((c) => c.diagnosis.type === "main_effect" || c.diagnosis.type === "interaction");
  const correctlyInconclusive = caseReports.filter((c) => c.expectedShape === "unstable" && c.diagnosis.type === "inconclusive");
  const falseConfident = decisive.filter((c) => {
    if (c.expectedShape !== "main_effect" && c.expectedShape !== "interaction") return true;
    return c.diagnosis.type !== c.expectedShape;
  });

  const reductions = caseReports.map((c) => Math.round(((c.exhaustiveConfigurations - c.configurationsVisited) / c.exhaustiveConfigurations) * 1000) / 10);
  const averageSearchSpaceReductionPct = reductions.length === 0 ? 0 : Math.round((reductions.reduce((a, b) => a + b, 0) / reductions.length) * 10) / 10;

  return {
    casesRun: caseReports.length,
    regressionsReproduced: regressions.length,
    decisiveDiagnoses: decisive.length,
    decisiveDiagnosesAmongRegressions: decisiveAmongRegressions.length,
    correctlyInconclusive: correctlyInconclusive.length,
    falseConfidentDiagnoses: falseConfident.length,
    averageSearchSpaceReductionPct,
    totalCodingAgentExecutions: caseReports.reduce((sum, c) => sum + c.totalCodingRuns, 0),
    totalInputTokens: caseReports.reduce((sum, c) => sum + c.totalInputTokens, 0),
    totalOutputTokens: caseReports.reduce((sum, c) => sum + c.totalOutputTokens, 0),
  };
}

/**
 * Only computes metrics directly derivable from the case reports themselves.
 * "falseConfidentDiagnoses" is defined as: a decisive (main_effect/interaction)
 * diagnosis whose factors do NOT match the case's own hypothesized
 * `expectedShape`'s factor set — this is a disagreement-with-our-own-prior
 * count, not a claim about real-world ground truth (we don't have independent
 * ground truth for a real stochastic coding agent; see the completion report
 * for why this number must not be read as statistical accuracy).
 *
 * Section 15: `controlledSeeded` cases are split out into their own group
 * and excluded from `totals` — a deliberately seeded fault isn't an
 * independent natural sample of real-world diagnostic accuracy.
 */
export function buildAggregateReport(caseReports: BenchmarkCaseReport[]): AggregateBenchmarkReport {
  const natural = caseReports.filter((c) => !c.controlledSeeded);
  const controlledSeededCases = caseReports.filter((c) => c.controlledSeeded);

  return {
    generatedAt: new Date().toISOString(),
    cases: natural,
    totals: computeTotals(natural),
    controlledSeededCases,
  };
}

export function formatAggregateReportMarkdown(report: AggregateBenchmarkReport): string {
  const lines: string[] = [];
  lines.push("# HarnessLab benchmark report", "", `Generated: ${report.generatedAt}`, "");
  lines.push("## Aggregate", "");
  lines.push(`- Cases: ${report.totals.casesRun}`);
  lines.push(`- Regressions reproduced: ${report.totals.regressionsReproduced} / ${report.totals.casesRun}`);
  lines.push(`- Decisive diagnoses: ${report.totals.decisiveDiagnoses}`);
  lines.push(`- Decisive diagnoses among reproduced regressions: ${report.totals.decisiveDiagnosesAmongRegressions} / ${report.totals.regressionsReproduced}`);
  lines.push(`- Correctly inconclusive (expected unstable, resolved inconclusive): ${report.totals.correctlyInconclusive}`);
  lines.push(`- Decisive diagnoses disagreeing with the pre-stated hypothesis: ${report.totals.falseConfidentDiagnoses}`);
  lines.push(`- Average search-space reduction: ${report.totals.averageSearchSpaceReductionPct}%`);
  lines.push(`- Total coding-agent executions: ${report.totals.totalCodingAgentExecutions}`);
  lines.push(`- Total tokens: ${report.totals.totalInputTokens} in / ${report.totals.totalOutputTokens} out`);
  lines.push("");
  lines.push("No statistical significance is claimed. Seeded `expectedShape` hypotheses are benchmark-design metadata, never fed into the diagnosis engine, and are not a claim of real-world diagnostic accuracy.");

  lines.push("", "## Natural / exploratory benchmark cases", "");
  for (const c of report.cases) {
    lines.push(`### ${c.name} (\`${c.caseId}\`)`, "");
    lines.push(`- Task: \`${c.taskId}\``);
    lines.push(`- Changed dimensions: ${c.changedDimensions.join(", ") || "(none)"}`);
    lines.push(`- Baseline stability: ${c.baselineStability} · Candidate stability: ${c.candidateStability}`);
    lines.push(`- Diagnosis: \`${JSON.stringify(c.diagnosis)}\``);
    lines.push(`- Evidence quality: ${c.evidenceQuality} — ${c.evidenceQualityReason}`);
    lines.push(`- Configurations visited: ${c.configurationsVisited} / ${c.exhaustiveConfigurations}`);
    lines.push(`- Total coding-agent runs: ${c.totalCodingRuns}${c.reusedExistingEvidence ? " (reused existing evidence — no new runs spent)" : ""}`);
    lines.push(`- Tokens: ${c.totalInputTokens} in / ${c.totalOutputTokens} out · Coding-agent latency: ${c.totalCodingAgentLatencyMs} ms · Sandbox setup: ${c.sandboxSetupMs ?? "n/a"} ms`);
    lines.push(`- Mechanism explanation available: ${c.mechanismExplanationAvailable}`);
    lines.push(`- Diagnosis evidence file id: \`${c.diagnosisId}\``);
    lines.push("");
  }

  lines.push(
    "## Controlled seeded benchmark",
    "",
    "Deliberately seeded harness regressions (fault injection), reported separately and never mixed into the natural-case aggregate above — see each case description for the seeded mechanism.",
    "",
  );
  for (const c of report.controlledSeededCases) {
    lines.push(`### ${c.name} (\`${c.caseId}\`)${c.heroCaseId ? ` — \`${c.heroCaseId}\`` : ""}`, "");
    lines.push(`- Task: \`${c.taskId}\``);
    lines.push(`- Changed dimensions: ${c.changedDimensions.join(", ") || "(none)"}`);
    lines.push(`- Expected factors (stated before the run, never seen by the engine): ${c.expectedFactors?.join(", ") ?? "(none stated)"}`);
    lines.push(`- Baseline stability: ${c.baselineStability} · Candidate stability: ${c.candidateStability}`);
    lines.push(`- Diagnosis: \`${JSON.stringify(c.diagnosis)}\``);
    lines.push(`- Factors match pre-stated expectation: ${c.factorsMatchExpectation === null ? "n/a" : c.factorsMatchExpectation}`);
    lines.push(`- Evidence quality: ${c.evidenceQuality} — ${c.evidenceQualityReason}`);
    lines.push(`- Configurations visited: ${c.configurationsVisited} / ${c.exhaustiveConfigurations}`);
    lines.push(`- Total coding-agent runs: ${c.totalCodingRuns}${c.reusedExistingEvidence ? " (reused existing evidence — no new runs spent)" : ""}`);
    lines.push(`- Tokens: ${c.totalInputTokens} in / ${c.totalOutputTokens} out · Coding-agent latency: ${c.totalCodingAgentLatencyMs} ms · Sandbox setup: ${c.sandboxSetupMs ?? "n/a"} ms`);
    lines.push(`- Mechanism explanation available: ${c.mechanismExplanationAvailable}`);
    lines.push(`- Diagnosis evidence file id: \`${c.diagnosisId}\``);
    lines.push(`- **heroQualified: ${c.heroQualified ? "YES" : "NO"}**`);
    if (!c.heroQualified) {
      lines.push(`  - Failed criteria:`);
      for (const f of c.heroQualificationFailures) lines.push(`    - ${f}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
