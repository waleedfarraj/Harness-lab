import "server-only";

import type { HarnessDimension } from "../harness/types";
import { bitsToConfiguration, buildHypothesisSpace } from "./hypotheses";
import { scoreConfiguration } from "./planner";
import { computeSeparatorRarity, decisionCriticality, evaluateProvisionalHypotheses } from "./stability";
import type { CellPattern, ConfigurationAggregate, DiagnosisHypothesis, PlannerAction, ReplicationPolicy } from "./types";

export interface PlannedStableAction {
  action: PlannerAction;
  bits: string;
  configuration: CellPattern;
  informationScore: number;
  decisionCriticality: number;
  separatorRarityScore: number;
  rarePairsSeparated: number;
  lookaheadRisk: boolean;
  whySelected: string;
}

// ===========================================================================
// Milestone 8 planner — kept verbatim under its own name, used only for the
// offline old-vs-new comparison (see scripts/diagnose-stable-simulate.ts and
// tests/diagnosis-stable-planner.test.ts). No longer the default: it ranked
// exploration purely on broad decisionCriticality/informationScore, which
// could keep exploring configurations that broadly touched many live
// disagreements while never happening on the one configuration that was the
// ONLY remaining way to separate a specific hard pair — see Milestone 9's
// `selectNextAction` below for the fix.
// ===========================================================================

function bestExploreCandidateMilestone8(
  dimensions: HarnessDimension[],
  aggregates: ConfigurationAggregate[],
  provisionalRemaining: DiagnosisHypothesis[],
  confirmedRemaining: DiagnosisHypothesis[],
): PlannedStableAction | null {
  const tested = new Set(aggregates.map((a) => a.configurationVector));
  const total = 2 ** dimensions.length;
  const allZeros = "0".repeat(dimensions.length);
  const allOnes = "1".repeat(dimensions.length);

  let best: PlannedStableAction | null = null;
  for (let n = 0; n < total; n++) {
    const bits = n.toString(2).padStart(dimensions.length, "0");
    if (bits === allZeros || bits === allOnes) continue;
    if (tested.has(bits)) continue;

    const configuration = bitsToConfiguration(bits, dimensions);
    const dc = decisionCriticality(configuration, provisionalRemaining);
    const { informationScore } = scoreConfiguration(configuration, confirmedRemaining);
    if (!best || dc > best.decisionCriticality || (dc === best.decisionCriticality && informationScore > best.informationScore) || (dc === best.decisionCriticality && informationScore === best.informationScore && bits < best.bits)) {
      best = {
        action: "explore",
        bits,
        configuration,
        informationScore,
        decisionCriticality: dc,
        separatorRarityScore: 0,
        rarePairsSeparated: 0,
        lookaheadRisk: false,
        whySelected:
          dc > 0
            ? `Separates ${dc} pair(s) of the ${provisionalRemaining.length} currently-leading hypotheses (the literal isolating contrast, or close to it) — highest priority among untested configurations.`
            : `Best balances the ${confirmedRemaining.length} confirmed-remaining hypotheses (predicted split informationScore=${informationScore}); does not yet separate the current leading hypotheses.`,
      };
    }
  }
  return best;
}

function bestConfirmCandidateMilestone8(aggregates: ConfigurationAggregate[], confirmedRemaining: DiagnosisHypothesis[], policy: ReplicationPolicy): PlannedStableAction | null {
  let best: PlannedStableAction | null = null;
  for (const agg of aggregates) {
    if (agg.evidenceMaturity === "replicated") continue;
    if (agg.runs.length >= policy.maxRunsPerConfiguration) continue;
    const dc = decisionCriticality(agg.configuration, confirmedRemaining);
    if (dc <= 0) continue;
    if (!best || dc > best.decisionCriticality || (dc === best.decisionCriticality && agg.configurationVector < best.bits)) {
      best = {
        action: "confirm",
        bits: agg.configurationVector,
        configuration: agg.configuration,
        informationScore: scoreConfiguration(agg.configuration, confirmedRemaining).informationScore,
        decisionCriticality: dc,
        separatorRarityScore: 0,
        rarePairsSeparated: 0,
        lookaheadRisk: false,
        whySelected: `${agg.label} (${agg.configurationVector}) is ${agg.evidenceMaturity} after ${agg.runs.length} run(s) and separates ${dc} pair(s) of the ${confirmedRemaining.length} confirmed-remaining hypotheses — confirming it directly narrows the official diagnosis.`,
      };
    }
  }
  return best;
}

/** The exact Milestone 8 algorithm, preserved only so it can be run side-by-side with the Milestone 9 planner for comparison. Never used by `diagnose-stable.ts`. */
export function selectNextActionMilestone8(
  dimensions: HarnessDimension[],
  confirmedRemaining: DiagnosisHypothesis[],
  provisionalRemaining: DiagnosisHypothesis[],
  aggregates: ConfigurationAggregate[],
  policy: ReplicationPolicy,
  remainingRunBudget: number,
): PlannedStableAction | null {
  if (confirmedRemaining.length <= 1) return null;
  if (remainingRunBudget <= 0) return null;

  const explorationBudget = Math.max(0, remainingRunBudget - policy.reservedConfirmationRuns);
  const confirmCandidate = bestConfirmCandidateMilestone8(aggregates, confirmedRemaining, policy);
  const exploreCandidate = bestExploreCandidateMilestone8(dimensions, aggregates, provisionalRemaining, confirmedRemaining);

  if (provisionalRemaining.length <= 2 && confirmCandidate) return confirmCandidate;
  if (explorationBudget > 0 && exploreCandidate) return exploreCandidate;
  if (confirmCandidate) return confirmCandidate;
  if (exploreCandidate) return exploreCandidate;
  return null;
}

// ===========================================================================
// Milestone 9 — separator rarity + bounded look-ahead. Fixes the specific
// failure mode above: it never selects an exploratory configuration that
// (once the hypothesis set has narrowed to <=3) fails to separate at least
// one confirmed-remaining pair, it weights rare separators (few or no other
// untested configuration could ever resolve that pair) alongside broad
// discrimination from the very first step, and it runs a bounded one-step
// look-ahead so it never happily spends the last of the budget on a choice
// that would leave a still-live pair with no possible way to resolve it.
//
// See stability.ts's `computeSeparatorRarity`/`decisionCriticality` for the
// exact deterministic math and RunStableDiagnosisOptions/StablePlannerStep in
// types.ts for how the evidence this produces is threaded into the result.
// ===========================================================================

type PlannerPhase = "early" | "narrowed" | "near_final";

/**
 * Deterministic phase from hypothesis count/state alone — never tuned to any
 * one fixture. "early": nothing has been confirmed-rejected yet (the full
 * candidate hypothesis space is still live) — broad discrimination is the
 * most useful signal, since nothing about which pairs are hard yet stands
 * out. "narrowed": at least one hypothesis has been eliminated but more than
 * 3 remain — this is exactly where Milestone 8 got lost, so decision-
 * criticality and separator rarity take priority over broad balance.
 * "near_final": down to the same <=3 hypotheses this milestone's spec calls
 * out for strong direct-distinguishability behavior (section 4).
 */
function plannerPhase(confirmedRemaining: DiagnosisHypothesis[], totalHypotheses: number): PlannerPhase {
  if (confirmedRemaining.length <= 3) return "near_final";
  if (confirmedRemaining.length < totalHypotheses) return "narrowed";
  return "early";
}

/** Every non-baseline/non-candidate, not-yet-tested configuration, keyed by its bit-vector. */
function untestedConfigurations(dimensions: HarnessDimension[], aggregates: ConfigurationAggregate[]): Map<string, CellPattern> {
  const tested = new Set(aggregates.map((a) => a.configurationVector));
  const total = 2 ** dimensions.length;
  const allZeros = "0".repeat(dimensions.length);
  const allOnes = "1".repeat(dimensions.length);
  const configs = new Map<string, CellPattern>();
  for (let n = 0; n < total; n++) {
    const bits = n.toString(2).padStart(dimensions.length, "0");
    if (bits === allZeros || bits === allOnes || tested.has(bits)) continue;
    configs.set(bits, bitsToConfiguration(bits, dimensions));
  }
  return configs;
}

/**
 * Builds a hypothetical `ConfigurationAggregate` for `bits` as if one more run
 * with `outcome` had just landed, reusing whatever runs it already has (0 if
 * never tested). Only the fields `evaluateProvisionalHypotheses` actually
 * reads (`configuration`, `passCount`, `failCount`) need to be accurate —
 * this never becomes real evidence, it is discarded immediately after the
 * look-ahead check.
 */
function withHypotheticalRun(aggregates: ConfigurationAggregate[], bits: string, configuration: CellPattern, outcome: boolean): ConfigurationAggregate[] {
  const existing = aggregates.find((a) => a.configurationVector === bits);
  const passCount = (existing?.passCount ?? 0) + (outcome ? 1 : 0);
  const failCount = (existing?.failCount ?? 0) + (outcome ? 0 : 1);
  const hypothetical: ConfigurationAggregate = existing
    ? { ...existing, passCount, failCount }
    : {
        configurationVector: bits,
        configuration,
        label: bits,
        runs: [],
        passCount,
        failCount,
        passRate: 0,
        failureRate: 0,
        terminationReasons: {},
        meanInputTokens: 0,
        meanOutputTokens: 0,
        meanLatencyMs: 0,
        stability: "unstable",
        evidenceMaturity: "provisional",
        isDecisionCritical: false,
      };
  return existing ? aggregates.map((a) => (a.configurationVector === bits ? hypothetical : a)) : [...aggregates, hypothetical];
}

/**
 * Bounded one-step look-ahead (Milestone 9 section 5): for EACH possible
 * outcome of running `bits` next, simulate PROVISIONAL hypothesis elimination
 * and check whether, if more than one hypothesis would still be alive, some
 * OTHER untested configuration remains that could separate at least one of
 * those surviving pairs, with at least one run of budget left to spend on it.
 * No live model calls, no deeper recursion — exactly the shallow check the
 * spec asks for, not full dynamic programming.
 */
function isLookaheadRisky(dimensions: HarnessDimension[], aggregates: ConfigurationAggregate[], bits: string, configuration: CellPattern, remainingBudgetAfterThisRun: number): boolean {
  for (const outcome of [true, false]) {
    const hypothetical = withHypotheticalRun(aggregates, bits, configuration, outcome);
    const remaining = evaluateProvisionalHypotheses(dimensions, hypothetical).filter((h) => h.status !== "rejected");
    if (remaining.length <= 1) continue; // this outcome alone would resolve it — no risk

    if (remainingBudgetAfterThisRun <= 0) return true; // nothing left to spend on separating whatever survives

    const total = 2 ** dimensions.length;
    let hasSeparator = false;
    for (let n = 0; n < total && !hasSeparator; n++) {
      const candidateBits = n.toString(2).padStart(dimensions.length, "0");
      if (candidateBits === bits) continue; // this run itself is spent; look for a DIFFERENT remaining path
      if (hypothetical.some((a) => a.configurationVector === candidateBits)) continue; // already tested, not a future option
      const candidateConfig = bitsToConfiguration(candidateBits, dimensions);
      if (decisionCriticality(candidateConfig, remaining) > 0) hasSeparator = true;
    }
    if (!hasSeparator) return true;
  }
  return false;
}

/**
 * Lexicographic comparison of ranking keys: every entry compares "higher is
 * better"; the first difference decides — a higher tier-1 value always wins
 * regardless of every later tier, no matter how much better the loser scores
 * there. Exported for direct testing of the phase tier-order itself (see
 * Milestone 9's adversarial "broad beats a premature rare corner" case),
 * since in this codebase's hypothesis model (main effects + pairwise
 * interactions only) `informationScore` and `separatorRarityScore` are
 * empirically strongly correlated at the very first diagnostic step, making
 * a naturally-occurring divergence hard to construct from real hypotheses —
 * the tier order itself is what actually needs to be verified.
 */
export function keyIsBetter(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function describeSeparatorRarity(pairsSeparated: { pairId: string; remainingSeparatorCount: number }[]): string | null {
  if (pairsSeparated.length === 0) return null;
  const rarest = pairsSeparated.reduce((min, p) => (p.remainingSeparatorCount < min.remainingSeparatorCount ? p : min));
  const [hypA, hypB] = rarest.pairId.split("|");
  return `one of only ${rarest.remainingSeparatorCount} remaining configuration(s) that distinguishes:\n\n${hypA}\nvs\n${hypB}`;
}

function bestExploreCandidateV9(
  dimensions: HarnessDimension[],
  aggregates: ConfigurationAggregate[],
  provisionalRemaining: DiagnosisHypothesis[],
  confirmedRemaining: DiagnosisHypothesis[],
  remainingRunBudget: number,
  phase: PlannerPhase,
): PlannedStableAction | null {
  const untested = untestedConfigurations(dimensions, aggregates);
  if (untested.size === 0) return null;

  const rarity = computeSeparatorRarity(confirmedRemaining, untested);

  let best: PlannedStableAction | null = null;
  let bestKey: number[] | null = null;

  for (const [bits, configuration] of untested) {
    const dcProvisional = decisionCriticality(configuration, provisionalRemaining);
    const dcConfirmed = decisionCriticality(configuration, confirmedRemaining);
    const dcForRanking = phase === "near_final" ? dcConfirmed : dcProvisional;

    // Section 4: once near-final, never pick a configuration that separates NOTHING in the official remaining set.
    if (phase === "near_final" && dcConfirmed === 0) continue;

    const { informationScore } = scoreConfiguration(configuration, confirmedRemaining);
    const rarityEntry = rarity.get(bits) ?? { score: 0, pairsSeparated: [], rarePairsSeparated: 0 };
    const risky = isLookaheadRisky(dimensions, aggregates, bits, configuration, remainingRunBudget - 1);
    const safe = risky ? 0 : 1;

    let key: number[];
    if (phase === "early") key = [informationScore, rarityEntry.score, dcForRanking, safe];
    else if (phase === "narrowed") key = [dcForRanking, rarityEntry.score, informationScore, safe];
    else key = [dcForRanking, rarityEntry.score, safe, informationScore];

    if (!best || !bestKey || keyIsBetter(key, bestKey) || (!keyIsBetter(bestKey, key) && bits < best.bits)) {
      const rarityReason = describeSeparatorRarity(rarityEntry.pairsSeparated);
      const whySelected =
        rarityEntry.rarePairsSeparated > 0 && rarityReason
          ? `Selected because it is ${rarityReason}${risky ? " (accepted despite look-ahead risk: no other option scored higher)" : ""}.`
          : dcForRanking > 0
            ? `Separates ${dcForRanking} pair(s) of the ${phase === "near_final" ? confirmedRemaining.length : provisionalRemaining.length} ${phase === "near_final" ? "confirmed-remaining" : "currently-leading"} hypotheses (separatorRarityScore=${rarityEntry.score.toFixed(3)})${risky ? " — look-ahead flags this as risky, but no safer option scored as well" : ""}.`
            : `Best balances the ${confirmedRemaining.length} confirmed-remaining hypotheses (predicted split informationScore=${informationScore}); does not yet separate the current leading hypotheses.`;

      best = {
        action: "explore",
        bits,
        configuration,
        informationScore,
        decisionCriticality: dcForRanking,
        separatorRarityScore: rarityEntry.score,
        rarePairsSeparated: rarityEntry.rarePairsSeparated,
        lookaheadRisk: risky,
        whySelected,
      };
      bestKey = key;
    }
  }
  return best;
}

function bestConfirmCandidateV9(aggregates: ConfigurationAggregate[], confirmedRemaining: DiagnosisHypothesis[], policy: ReplicationPolicy): PlannedStableAction | null {
  let best: PlannedStableAction | null = null;
  for (const agg of aggregates) {
    if (agg.evidenceMaturity === "replicated") continue; // already confirmed, nothing more to gain
    if (agg.runs.length >= policy.maxRunsPerConfiguration) continue; // exhausted its budget
    const dc = decisionCriticality(agg.configuration, confirmedRemaining);
    if (dc <= 0) continue; // NOT decision-critical for the official (confirmed) hypothesis set — never confirm this just because it was explored
    if (!best || dc > best.decisionCriticality || (dc === best.decisionCriticality && agg.configurationVector < best.bits)) {
      best = {
        action: "confirm",
        bits: agg.configurationVector,
        configuration: agg.configuration,
        informationScore: scoreConfiguration(agg.configuration, confirmedRemaining).informationScore,
        decisionCriticality: dc,
        // Rarity is an exploration-selection concept — this configuration's rarity value (if any) was already
        // spent the moment it was first explored; confirming it doesn't compete for the exploration frontier.
        separatorRarityScore: 0,
        rarePairsSeparated: 0,
        lookaheadRisk: false,
        whySelected: `${agg.label} (${agg.configurationVector}) is ${agg.evidenceMaturity} after ${agg.runs.length} run(s) and separates ${dc} pair(s) of the ${confirmedRemaining.length} confirmed-remaining hypotheses — confirming it directly narrows the official diagnosis.`,
      };
    }
  }
  return best;
}

/**
 * Milestone 9's budget-aware adaptive choice. Deterministic, no LLM. Default
 * planner used by `diagnose-stable.ts`; see `selectNextActionMilestone8`
 * above for the prior algorithm, kept only for offline comparison.
 *
 * Priority, in order:
 *   1. If the PROVISIONAL-remaining set is down to <= 2, OR the official
 *      CONFIRMED-remaining set is down to <= 2 (section 4's literal
 *      "two hypotheses remain" case, which may not coincide with
 *      provisional narrowing), and there's something already-tested worth
 *      confirming, confirm it now — reusing an already-partially-tested
 *      configuration is strictly less redundant than spending a fresh
 *      exploratory run on brand-new ground.
 *   2. Otherwise, if exploration budget remains (remainingRunBudget minus
 *      the reserved confirmation runs) and there's an untested
 *      configuration, explore it. Ranking depends on `plannerPhase`:
 *        - "early" (nothing confirmed-rejected yet): broad `informationScore`
 *          first, separator rarity second, decisionCriticality third.
 *        - "narrowed" (something rejected, >3 hypotheses remain — where
 *          Milestone 8 got lost): decisionCriticality (against the
 *          PROVISIONAL-leading set) first, separator rarity second,
 *          `informationScore` third.
 *        - "near_final" (<=3 confirmed-remaining): decisionCriticality
 *          against the OFFICIAL CONFIRMED-remaining set first (and a
 *          configuration that separates nothing in that set is excluded
 *          entirely — never spend a run that can't possibly move the
 *          official diagnosis), separator rarity second.
 *      Every tier folds in a look-ahead safety signal (prefer a choice that
 *      doesn't risk leaving a surviving pair with no way to resolve it) and
 *      always finishes on the lexicographically smallest bit string, so the
 *      same inputs always choose the same experiment.
 *   3. Otherwise (exploration budget exhausted), fall back to confirming
 *      whatever is decision-critical and available.
 *   4. Otherwise, if nothing is left to confirm, spend any leftover budget
 *      exploring anyway rather than wasting it.
 *   5. Otherwise there is genuinely nothing useful left to do — return null.
 *      (Once near-final, this also covers the case where no untested
 *      configuration can separate the surviving hypotheses at all — the
 *      planner stops rather than burning budget on a run that cannot change
 *      the outcome, and the diagnosis is reported inconclusive with the
 *      surviving hypotheses named.)
 */
export function selectNextAction(
  dimensions: HarnessDimension[],
  confirmedRemaining: DiagnosisHypothesis[],
  provisionalRemaining: DiagnosisHypothesis[],
  aggregates: ConfigurationAggregate[],
  policy: ReplicationPolicy,
  remainingRunBudget: number,
): PlannedStableAction | null {
  if (confirmedRemaining.length <= 1) return null;
  if (remainingRunBudget <= 0) return null;

  const totalHypotheses = buildHypothesisSpace(dimensions).length;
  const phase = plannerPhase(confirmedRemaining, totalHypotheses);

  const explorationBudget = Math.max(0, remainingRunBudget - policy.reservedConfirmationRuns);
  const confirmCandidate = bestConfirmCandidateV9(aggregates, confirmedRemaining, policy);
  const exploreCandidate = bestExploreCandidateV9(dimensions, aggregates, provisionalRemaining, confirmedRemaining, remainingRunBudget, phase);

  const downToTheWire = provisionalRemaining.length <= 2 || confirmedRemaining.length <= 2;

  if (downToTheWire && confirmCandidate) return confirmCandidate;
  if (explorationBudget > 0 && exploreCandidate) return exploreCandidate;
  if (confirmCandidate) return confirmCandidate;
  if (exploreCandidate) return exploreCandidate;
  return null;
}
