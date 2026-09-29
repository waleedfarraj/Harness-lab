import "server-only";

import type { HarnessDimension } from "../harness/types";
import type { ExperimentResult } from "../experiments/types";
import { buildHypothesisSpace, predict } from "./hypotheses";
import type { CellPattern, ConfigurationAggregate, DiagnosisHypothesis, StabilityClassification } from "./types";

/**
 * Exact decimal thresholds (not the fractions 1/3, 2/3): with
 * maxRunsPerConfiguration=3, the only non-extreme split outcomes are
 * exactly 1/3 (~0.3333) and 2/3 (~0.6667) — both fall strictly INSIDE this
 * band (0.3333 > 0.33, 0.6667 < 0.67), so they are deliberately preserved as
 * "unstable" rather than silently rounded into a clean verdict. A run
 * sequence that disagreed at minRuns and still hasn't resolved by maxRuns is
 * genuinely ambiguous evidence, and HarnessLab reports it as such instead of
 * inventing confidence it doesn't have.
 */
export const SAFE_FAILURE_RATE_MAX = 0.33;
export const REGRESSING_FAILURE_RATE_MIN = 0.67;

/**
 * Deterministic aggregate classification. Requires at least `minRuns`
 * observations before it will ever call a configuration "mostly_pass" or
 * "mostly_fail" — fewer than that is always "unstable", regardless of how
 * the runs so far happen to agree, because a single lucky/unlucky run proves
 * nothing on its own.
 */
export function classifyStability(passCount: number, failCount: number, minRuns: number): StabilityClassification {
  const total = passCount + failCount;
  if (total < minRuns) return "unstable";
  const failureRate = failCount / total;
  if (failureRate <= SAFE_FAILURE_RATE_MAX) return "mostly_pass";
  if (failureRate >= REGRESSING_FAILURE_RATE_MIN) return "mostly_fail";
  return "unstable";
}

/**
 * Sequential replication policy (deterministic, no LLM — see Milestone 7
 * spec section 4). Always collect at least `minRuns`. Once at `minRuns`,
 * stop immediately if the evidence already agrees (mostly_pass/mostly_fail);
 * only keep going, up to `maxRuns`, while the aggregate is still "unstable".
 * Never runs more than `maxRuns`, no matter how ambiguous the evidence
 * remains — see classifyStability's doc comment for what happens then.
 */
export function needsMoreRuns(passCount: number, failCount: number, minRuns: number, maxRuns: number): boolean {
  const total = passCount + failCount;
  if (total >= maxRuns) return false;
  if (total < minRuns) return true;
  return classifyStability(passCount, failCount, minRuns) === "unstable";
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Builds a `ConfigurationAggregate` from a configuration's accumulated runs
 * so far. Never discards individual run evidence — `runs` is preserved in
 * full, as a COPY: callers (e.g. diagnose-stable.ts) keep accumulating runs
 * for a bits into their own live array as replication continues, and each
 * `ConfigurationAggregate` returned here must stay a frozen, point-in-time
 * snapshot rather than silently growing later when that shared array is
 * mutated — otherwise an earlier planner step's `aggregateAfter.runs` would
 * retroactively "gain" runs that didn't exist yet when that step happened,
 * corrupting the very evidence trail this milestone exists to preserve.
 */
export function buildAggregate(bits: string, configuration: CellPattern, label: string, runs: ExperimentResult[], minRuns: number): ConfigurationAggregate {
  const runsSnapshot = [...runs];
  const passCount = runsSnapshot.filter((r) => r.success).length;
  const failCount = runsSnapshot.length - passCount;
  const terminationReasons: Record<string, number> = {};
  for (const r of runsSnapshot) terminationReasons[r.terminationReason] = (terminationReasons[r.terminationReason] ?? 0) + 1;

  return {
    configurationVector: bits,
    configuration,
    label,
    runs: runsSnapshot,
    passCount,
    failCount,
    passRate: runsSnapshot.length === 0 ? 0 : passCount / runsSnapshot.length,
    failureRate: runsSnapshot.length === 0 ? 0 : failCount / runsSnapshot.length,
    terminationReasons,
    meanInputTokens: mean(runsSnapshot.map((r) => r.metrics.inputTokens ?? 0)),
    meanOutputTokens: mean(runsSnapshot.map((r) => r.metrics.outputTokens ?? 0)),
    meanLatencyMs: mean(runsSnapshot.map((r) => r.metrics.latencyMs)),
    stability: classifyStability(passCount, failCount, minRuns),
  };
}

/** "mostly_pass"->true (PASS observed), "mostly_fail"->false (FAIL observed), "unstable"->null (no usable evidence either way). */
export function aggregateOutcome(stability: StabilityClassification): boolean | null {
  if (stability === "mostly_pass") return true;
  if (stability === "mostly_fail") return false;
  return null;
}

/**
 * Aggregate-evidence version of `evaluateHypotheses` (Milestone 6): each
 * hypothesis is rejected the moment a *decisively classified* aggregate
 * (mostly_pass or mostly_fail) contradicts its prediction. "unstable"
 * aggregates are silently skipped — they carry no evidence for or against
 * any hypothesis, by construction, so a still-ambiguous configuration can
 * never falsely reject (or falsely support) a hypothesis. This is what lets
 * an unresolved instability show up later as "inconclusive" instead of as a
 * wrong answer.
 */
export function evaluateAggregateHypotheses(dimensions: HarnessDimension[], aggregates: ConfigurationAggregate[]): DiagnosisHypothesis[] {
  const space = buildHypothesisSpace(dimensions);
  const decisive = aggregates.filter((a) => aggregateOutcome(a.stability) !== null);

  const evaluated = space.map((hypothesis): DiagnosisHypothesis => {
    const contradictions = decisive.filter((agg) => predict(hypothesis, agg.configuration) !== aggregateOutcome(agg.stability));
    if (contradictions.length > 0) {
      return {
        ...hypothesis,
        status: "rejected",
        evidenceAgainst: contradictions.map(
          (agg) =>
            `${agg.label} (${agg.configurationVector}, ${agg.stability}, failure rate ${(agg.failureRate * 100).toFixed(1)}% over ${agg.runs.length} runs): predicted ${predict(hypothesis, agg.configuration) ? "PASS" : "FAIL"} but observed ${agg.stability}`,
        ),
      };
    }
    return { ...hypothesis, status: "possible" };
  });

  const possible = evaluated.filter((h) => h.status === "possible");
  if (possible.length === 1) {
    const only = possible[0];
    only.status = "supported";
    only.evidenceFor = decisive.map((agg) => `${agg.label} (${agg.configurationVector}, ${agg.stability}) is consistent with this hypothesis`);
  }

  return evaluated;
}
