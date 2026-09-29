import "server-only";

import type { HarnessDimension } from "../harness/types";
import type { ExperimentResult } from "../experiments/types";
import { buildHypothesisSpace, predict } from "./hypotheses";
import type { CellPattern, ConfigurationAggregate, DiagnosisHypothesis, EvidenceMaturity, StabilityClassification } from "./types";

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

/**
 * Milestone 8's confidence tier. "provisional" is not a failure state — a
 * newly-explored configuration is SUPPOSED to sit at "provisional" until
 * something decides it's worth confirming; see diagnose-stable.ts's planner.
 * "unstable" only applies once >= minRuns were actually collected and they
 * still don't agree (a real inconsistency, not just under-sampling).
 */
export function computeEvidenceMaturity(runCount: number, minRuns: number, stability: StabilityClassification): EvidenceMaturity {
  if (runCount < minRuns) return "provisional";
  return stability === "unstable" ? "unstable" : "replicated";
}

/**
 * The current majority lean from however many runs exist so far — usable to
 * GUIDE exploration, never to decide a final diagnosis (that's `stability`,
 * which requires minRuns and applies the deliberate 0.33/0.67 gap). For a
 * single run this is just that run's own outcome (trivially unanimous).
 * Returns null only when genuinely tied (e.g. 1 pass / 1 fail, or no runs
 * yet) — a tie has no lean at all, provisional or otherwise.
 */
export function provisionalOutcome(agg: Pick<ConfigurationAggregate, "passCount" | "failCount">): boolean | null {
  if (agg.passCount === agg.failCount) return null;
  return agg.passCount > agg.failCount;
}

/**
 * How many pairs of `hypotheses` this configuration would separate (i.e.
 * `predict` disagrees for that pair). Milestone 8's generalization of "does
 * this configuration distinguish the two remaining explanations" to any
 * number of remaining hypotheses: with exactly 2 remaining, this is 1 iff
 * they disagree here (the literal isolating contrast) and 0 otherwise; with
 * more remaining, it naturally scores configurations that cut across more
 * of the live disagreements. Symmetric, deterministic, no LLM.
 */
export function decisionCriticality(configuration: CellPattern, hypotheses: DiagnosisHypothesis[]): number {
  let count = 0;
  for (let i = 0; i < hypotheses.length; i++) {
    for (let j = i + 1; j < hypotheses.length; j++) {
      if (predict(hypotheses[i], configuration) !== predict(hypotheses[j], configuration)) count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Milestone 9: separator rarity / unique-separator value. `decisionCriticality`
// above answers "how many currently-live disagreements does this configuration
// touch" — a BROAD measure that treats every disagreeing pair as equally
// valuable. It says nothing about whether a given pair has 8 other equally
// good untested configurations that could separate it just as well, or
// exactly one. A pair with a single remaining separator is disproportionately
// important: miss that one configuration (spend the budget elsewhere) and the
// pair can never be resolved at all, no matter how much broad exploration
// happens afterward. See stable-planner.ts's `selectNextAction` for how this
// combines with `decisionCriticality` and the Milestone 6 balanced-split
// `informationScore` into one deterministic ranking. Not Bayesian information
// gain: it is an exact, deterministic count over the actual untested
// configuration pool, never a probability estimate.
// ---------------------------------------------------------------------------

/** A stable, order-independent identifier for an unordered pair of hypotheses, e.g. "interaction:skills+contextPolicy|main_effect:skills". */
export function hypothesisPairId(a: DiagnosisHypothesis, b: DiagnosisHypothesis): string {
  return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
}

/**
 * A pair is treated as a "rare" separator target once its remaining
 * separator count drops to this many or fewer untested configurations. Like
 * `SAFE_FAILURE_RATE_MAX`/`REGRESSING_FAILURE_RATE_MIN` above, this is a
 * fixed, documented constant rather than something tuned to any one
 * scenario: a pair separated by at most 2 remaining configurations has few
 * enough alternatives that failing to test one of them meaningfully risks
 * never being able to separate it within a small remaining budget. It is
 * used only for the informational `rarePairsSeparated` count exposed on
 * planner evidence — ranking itself uses the continuous `score`, which needs
 * no threshold at all.
 */
export const RARE_SEPARATOR_THRESHOLD = 2;

/** One hypothesis pair's contribution to a configuration's separator-rarity score. */
export interface SeparatorPairContribution {
  pairId: string;
  hypothesisAId: string;
  hypothesisBId: string;
  /** How many configurations in the untested pool passed to `computeSeparatorRarity` separate this pair — the rarity denominator. */
  remainingSeparatorCount: number;
}

export interface SeparatorRarityResult {
  /** sum over every hypothesis pair this configuration separates of 1 / remainingSeparatorCount(pair). Exact, deterministic. */
  score: number;
  pairsSeparated: SeparatorPairContribution[];
  /** How many of `pairsSeparated` have remainingSeparatorCount <= RARE_SEPARATOR_THRESHOLD. */
  rarePairsSeparated: number;
}

/**
 * For every configuration in `untestedConfigs`, computes its separator-rarity
 * score against every pair of `hypotheses`: for each pair (Hi, Hj), find every
 * configuration in the pool that separates them (`predict` disagrees), and
 * give each separating configuration 1/count credit for that pair — a pair
 * with only 1 separator in the pool gives its one separating configuration a
 * full point; a pair with 8 separators gives each only 1/8. Pairs with zero
 * remaining separators in the pool contribute to no configuration's score
 * (there is nothing left that could resolve them by exploration alone).
 *
 * `hypotheses` is normally the CONFIRMED-remaining set — the official
 * hypothesis space the final diagnosis is actually measured against — so a
 * pair that matters gets weighted from the very first step, before it has
 * necessarily narrowed down to the last two survivors.
 */
export function computeSeparatorRarity(hypotheses: DiagnosisHypothesis[], untestedConfigs: Map<string, CellPattern>): Map<string, SeparatorRarityResult> {
  const results = new Map<string, SeparatorRarityResult>();
  for (const bits of untestedConfigs.keys()) results.set(bits, { score: 0, pairsSeparated: [], rarePairsSeparated: 0 });

  for (let i = 0; i < hypotheses.length; i++) {
    for (let j = i + 1; j < hypotheses.length; j++) {
      const a = hypotheses[i];
      const b = hypotheses[j];
      const separatingBits: string[] = [];
      for (const [bits, configuration] of untestedConfigs) {
        if (predict(a, configuration) !== predict(b, configuration)) separatingBits.push(bits);
      }
      if (separatingBits.length === 0) continue; // nothing left in the pool could ever separate this pair

      const remainingSeparatorCount = separatingBits.length;
      const weight = 1 / remainingSeparatorCount;
      const pairId = hypothesisPairId(a, b);
      const isRare = remainingSeparatorCount <= RARE_SEPARATOR_THRESHOLD;
      for (const bits of separatingBits) {
        const entry = results.get(bits)!;
        entry.score += weight;
        entry.pairsSeparated.push({ pairId, hypothesisAId: a.id, hypothesisBId: b.id, remainingSeparatorCount });
        if (isRare) entry.rarePairsSeparated += 1;
      }
    }
  }
  return results;
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
    evidenceMaturity: computeEvidenceMaturity(runsSnapshot.length, minRuns, classifyStability(passCount, failCount, minRuns)),
    // Recomputed fresh every planner step by diagnose-stable.ts's `markDecisionCritical`, once the
    // current confirmed-remaining hypothesis set is known — this default only applies before that.
    isDecisionCritical: false,
  };
}

/** "mostly_pass"->true (PASS observed), "mostly_fail"->false (FAIL observed), "unstable"->null (no usable evidence either way). */
export function aggregateOutcome(stability: StabilityClassification): boolean | null {
  if (stability === "mostly_pass") return true;
  if (stability === "mostly_fail") return false;
  return null;
}

function evaluateHypothesesFromOutcomes(
  dimensions: HarnessDimension[],
  aggregates: ConfigurationAggregate[],
  outcomeOf: (agg: ConfigurationAggregate) => boolean | null,
  describeOutcome: (agg: ConfigurationAggregate) => string,
): DiagnosisHypothesis[] {
  const space = buildHypothesisSpace(dimensions);
  const usable = aggregates.filter((a) => outcomeOf(a) !== null);

  const evaluated = space.map((hypothesis): DiagnosisHypothesis => {
    const contradictions = usable.filter((agg) => predict(hypothesis, agg.configuration) !== outcomeOf(agg));
    if (contradictions.length > 0) {
      return {
        ...hypothesis,
        status: "rejected",
        evidenceAgainst: contradictions.map(
          (agg) => `${agg.label} (${agg.configurationVector}): predicted ${predict(hypothesis, agg.configuration) ? "PASS" : "FAIL"} but observed ${describeOutcome(agg)}`,
        ),
      };
    }
    return { ...hypothesis, status: "possible" };
  });

  const possible = evaluated.filter((h) => h.status === "possible");
  if (possible.length === 1) {
    const only = possible[0];
    only.status = "supported";
    only.evidenceFor = usable.map((agg) => `${agg.label} (${agg.configurationVector}, ${describeOutcome(agg)}) is consistent with this hypothesis`);
  }

  return evaluated;
}

/**
 * CONFIRMED-evidence hypothesis elimination (Milestone 7's model, unchanged):
 * each hypothesis is rejected the moment a *replicated* aggregate (stability
 * mostly_pass/mostly_fail, from >= minRuns consistent runs) contradicts its
 * prediction. "provisional" (single-run) and "unstable" aggregates are
 * silently skipped — they carry no evidence for or against any hypothesis
 * at this layer, by construction. This is what the FINAL `diagnosis` is
 * based on.
 */
export function evaluateAggregateHypotheses(dimensions: HarnessDimension[], aggregates: ConfigurationAggregate[]): DiagnosisHypothesis[] {
  return evaluateHypothesesFromOutcomes(
    dimensions,
    aggregates,
    (agg) => aggregateOutcome(agg.stability),
    (agg) => `${agg.stability}, failure rate ${(agg.failureRate * 100).toFixed(1)}% over ${agg.runs.length} runs`,
  );
}

/**
 * PROVISIONAL-evidence hypothesis elimination (Milestone 8, new): the same
 * elimination logic, but a single-run "provisional" aggregate's own outcome
 * counts too (via `provisionalOutcome`'s majority lean), not just replicated
 * evidence. This produces the CURRENT-BEST-GUESS "leading" hypothesis set —
 * narrower than (a subset of) `evaluateAggregateHypotheses`'s confirmed set —
 * used only to steer the planner (which configuration to explore/confirm
 * next), never to set the final `diagnosis`. A hypothesis "provisionally
 * rejected" here can still be resolved back to "possible" by a later run
 * that overturns a single-run lean — it was never permanently erased.
 */
export function evaluateProvisionalHypotheses(dimensions: HarnessDimension[], aggregates: ConfigurationAggregate[]): DiagnosisHypothesis[] {
  return evaluateHypothesesFromOutcomes(
    dimensions,
    aggregates,
    (agg) => provisionalOutcome(agg),
    (agg) => `${agg.evidenceMaturity} lean, ${agg.passCount}/${agg.runs.length} pass over ${agg.runs.length} run(s)`,
  );
}
