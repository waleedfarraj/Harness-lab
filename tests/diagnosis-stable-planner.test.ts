import assert from "node:assert/strict";
import { test } from "node:test";
import { bitsToConfiguration, buildHypothesisSpace } from "../src/lib/diagnosis/hypotheses";
import { scoreConfiguration } from "../src/lib/diagnosis/planner";
import { selectNextAction, selectNextActionMilestone8 } from "../src/lib/diagnosis/stable-planner";
import { decisionCriticality } from "../src/lib/diagnosis/stability";
import type { ConfigurationAggregate, DiagnosisHypothesis, ReplicationPolicy } from "../src/lib/diagnosis/types";
import type { HarnessDimension } from "../src/lib/harness/types";

const DIMS2: [HarnessDimension, HarnessDimension] = ["skills", "contextPolicy"];
const DIMS4: [HarnessDimension, HarnessDimension, HarnessDimension, HarnessDimension] = ["skills", "contextPolicy", "systemPrompt", "execution.maxTurns"];
const POLICY: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 10, reservedConfirmationRuns: 2 };

function aggregateOf(
  bits: string,
  configuration: ConfigurationAggregate["configuration"],
  stability: ConfigurationAggregate["stability"],
  evidenceMaturity: ConfigurationAggregate["evidenceMaturity"],
  runCount: number,
): ConfigurationAggregate {
  return {
    configurationVector: bits,
    configuration,
    label: bits,
    runs: new Array(runCount).fill(null),
    passCount: 0,
    failCount: 0,
    passRate: 0,
    failureRate: 0.5,
    terminationReasons: {},
    meanInputTokens: 0,
    meanOutputTokens: 0,
    meanLatencyMs: 0,
    stability,
    evidenceMaturity,
    isDecisionCritical: false,
  };
}

const baseline2 = aggregateOf("00", { skills: "baseline", contextPolicy: "baseline" }, "mostly_pass", "replicated", 2);
const candidate2 = aggregateOf("11", { skills: "candidate", contextPolicy: "candidate" }, "mostly_fail", "replicated", 2);

test("selectNextAction: returns null once at most one confirmed hypothesis remains", () => {
  const single = buildHypothesisSpace(["skills"]);
  assert.equal(selectNextAction(["skills"], single, single, [], POLICY, 5), null);
  assert.equal(selectNextAction(["skills"], [], [], [], POLICY, 5), null);
});

test("selectNextAction: returns null when remainingRunBudget is 0", () => {
  const hypotheses = buildHypothesisSpace(DIMS2);
  assert.equal(selectNextAction(DIMS2, hypotheses, hypotheses, [], POLICY, 0), null);
});

test("selectNextAction: with nothing tested yet, explores a new configuration (never 'confirm' on the first move)", () => {
  const hypotheses = buildHypothesisSpace(DIMS2);
  const planned = selectNextAction(DIMS2, hypotheses, hypotheses, [baseline2, candidate2], POLICY, 5);
  assert.ok(planned);
  assert.equal(planned!.action, "explore");
  assert.ok(["01", "10"].includes(planned!.bits));
});

test("selectNextAction: never spends a run confirming a configuration that isn't decision-critical for the CONFIRMED-remaining hypotheses", () => {
  // Reject the interaction hypothesis so only the two main effects remain confirmed; an untested/provisional
  // aggregate at "00" (already resolved, replicated) can't be a confirm target at all (it's replicated, not
  // provisional/unstable) — this exercises bestConfirmCandidate's filtering more directly via a provisional
  // aggregate that happens to be IRRELEVANT to what's left.
  const hypotheses = buildHypothesisSpace(DIMS2).map((h) => (h.type === "interaction" ? { ...h, status: "rejected" as const } : h));
  const confirmedRemaining = hypotheses.filter((h) => h.status !== "rejected"); // main_effect:skills, main_effect:contextPolicy
  // "00" (baseline's own configuration) predicts PASS under both remaining main effects -> decisionCriticality 0 -> never a valid confirm target.
  const irrelevant = aggregateOf("00", { skills: "baseline", contextPolicy: "baseline" }, "unstable", "provisional", 1);
  const planned = selectNextAction(DIMS2, confirmedRemaining, confirmedRemaining, [baseline2, candidate2, irrelevant], POLICY, 5);
  assert.ok(planned);
  assert.notEqual(planned!.bits, "00", "the irrelevant provisional aggregate must never be chosen as a confirm target");
});

test("selectNextAction: once provisional-remaining is down to 2, prefers CONFIRMING an already-tested decisive configuration over exploring a new one", () => {
  const hypotheses = buildHypothesisSpace(DIMS2); // main:skills, main:contextPolicy, interaction
  const confirmedRemaining = hypotheses; // official diagnosis still has all 3 possible (nothing confirmed-rejected yet)
  const mainSkills = hypotheses.find((h) => h.id === "main_effect:skills")!;
  const interaction = hypotheses.find((h) => h.type === "interaction")!;
  const provisionalRemaining = [mainSkills, interaction]; // down to 2 leading hypotheses provisionally

  // "10" (skills=candidate, contextPolicy=baseline) is the literal isolating contrast between these two,
  // already explored once (provisional, 1 run) — decisionCriticality against confirmedRemaining (all 3) is 2.
  const provisionalContrast = aggregateOf("10", { skills: "candidate", contextPolicy: "baseline" }, "unstable", "provisional", 1);
  const planned = selectNextAction(DIMS2, confirmedRemaining, provisionalRemaining, [baseline2, candidate2, provisionalContrast], POLICY, 5);
  assert.ok(planned);
  assert.equal(planned!.action, "confirm");
  assert.equal(planned!.bits, "10");
});

test("selectNextAction: does not confirm a configuration that already reached 'replicated' maturity", () => {
  const hypotheses = buildHypothesisSpace(DIMS2);
  const mainSkills = hypotheses.find((h) => h.id === "main_effect:skills")!;
  const interaction = hypotheses.find((h) => h.type === "interaction")!;
  const provisionalRemaining = [mainSkills, interaction];

  const alreadyReplicated = aggregateOf("10", { skills: "candidate", contextPolicy: "baseline" }, "mostly_pass", "replicated", 2);
  const planned = selectNextAction(DIMS2, hypotheses, provisionalRemaining, [baseline2, candidate2, alreadyReplicated], POLICY, 5);
  assert.ok(planned);
  // Nothing left to confirm at "10" (already replicated) — falls back to exploring the one remaining untested bits.
  assert.equal(planned!.action, "explore");
  assert.equal(planned!.bits, "01");
});

test("selectNextAction: does not confirm a configuration that already exhausted maxRunsPerConfiguration", () => {
  const hypotheses = buildHypothesisSpace(DIMS2);
  const mainSkills = hypotheses.find((h) => h.id === "main_effect:skills")!;
  const interaction = hypotheses.find((h) => h.type === "interaction")!;
  const provisionalRemaining = [mainSkills, interaction];

  const exhausted = aggregateOf("10", { skills: "candidate", contextPolicy: "baseline" }, "unstable", "unstable", 3); // at maxRuns, still unstable
  const planned = selectNextAction(DIMS2, hypotheses, provisionalRemaining, [baseline2, candidate2, exhausted], POLICY, 5);
  assert.ok(planned);
  assert.equal(planned!.action, "explore");
  assert.equal(planned!.bits, "01");
});

test("selectNextActionMilestone8: exploration prioritizes the configuration with the highest decisionCriticality against the PROVISIONAL-leading hypotheses, informationScore as tiebreak (4-dim)", () => {
  const hypotheses = buildHypothesisSpace(DIMS4); // 10 hypotheses
  const baseline4 = aggregateOf("0000", {}, "mostly_pass", "replicated", 2);
  const candidate4 = aggregateOf("1111", {}, "mostly_fail", "replicated", 2);
  // Narrow the provisional-remaining set (as if earlier exploration already ruled out systemPrompt/maxTurns hypotheses).
  const provisionalRemaining = hypotheses.filter((h) => h.factors.every((f) => f === "skills" || f === "contextPolicy"));
  const planned = selectNextActionMilestone8(DIMS4, hypotheses, provisionalRemaining, [baseline4, candidate4], POLICY, 8);
  assert.ok(planned);
  assert.equal(planned!.action, "explore");

  // Compute the expected winner independently (brute force over all untested bits), rather than hand-deriving
  // it, so this test verifies the actual priority ordering rather than a guessed literal answer.
  const tested = new Set(["0000", "1111"]);
  let expected: { bits: string; dc: number; info: number } | null = null;
  for (let n = 0; n < 16; n++) {
    const bits = n.toString(2).padStart(4, "0");
    if (tested.has(bits)) continue;
    const configuration = bitsToConfiguration(bits, DIMS4);
    const dc = decisionCriticality(configuration, provisionalRemaining);
    const { informationScore } = scoreConfiguration(configuration, hypotheses);
    if (!expected || dc > expected.dc || (dc === expected.dc && informationScore > expected.info) || (dc === expected.dc && informationScore === expected.info && bits < expected.bits)) {
      expected = { bits, dc, info: informationScore };
    }
  }
  assert.ok(expected);
  assert.equal(planned!.bits, expected!.bits);
  assert.equal(planned!.decisionCriticality, expected!.dc);
});

test("decisionCriticality against the narrowed provisional set never exceeds the theoretical max (1 pair)", () => {
  // Sanity check underpinning the test above: with exactly 3 provisional-remaining hypotheses, at most
  // C(3,2)=3 pairs can be separated by any single configuration.
  const hypotheses = buildHypothesisSpace(DIMS4);
  const narrowed: DiagnosisHypothesis[] = hypotheses.filter((h) => h.factors.every((f) => f === "skills" || f === "contextPolicy"));
  assert.equal(narrowed.length, 3);
  for (let n = 0; n < 16; n++) {
    const bits = n.toString(2).padStart(4, "0");
    const dc = decisionCriticality(bitsToConfiguration(bits, DIMS4), narrowed);
    assert.ok(dc <= 3);
  }
});

test("selectNextAction: respects the reserved confirmation budget by preferring exploration while it remains, once provisional-remaining is still large", () => {
  const hypotheses = buildHypothesisSpace(DIMS2);
  // All 3 hypotheses still provisionally alive (no narrowing yet) -> provisionalRemaining.length=3 > 2, so rule 1
  // (confirm once down to <=2) does not apply, and with exploration budget available we should explore.
  const planned = selectNextAction(DIMS2, hypotheses, hypotheses, [baseline2, candidate2], POLICY, 5);
  assert.ok(planned);
  assert.equal(planned!.action, "explore");
});
