import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateOutcome,
  buildAggregate,
  classifyStability,
  computeEvidenceMaturity,
  decisionCriticality,
  evaluateAggregateHypotheses,
  evaluateProvisionalHypotheses,
  needsMoreRuns,
  provisionalOutcome,
} from "../src/lib/diagnosis/stability";
import { buildHypothesisSpace } from "../src/lib/diagnosis/hypotheses";
import type { ConfigurationAggregate } from "../src/lib/diagnosis/types";
import type { ExperimentResult } from "../src/lib/experiments/types";
import type { HarnessDimension } from "../src/lib/harness/types";

const DIMS2: [HarnessDimension, HarnessDimension] = ["skills", "contextPolicy"];

function fakeResult(success: boolean, id: string, overrides: Partial<ExperimentResult["metrics"]> = {}): ExperimentResult {
  return {
    runId: `run-${id}-${Math.random()}`,
    taskId: "t",
    manifestId: id,
    success,
    terminationReason: success ? "completed" : "max_turns",
    evaluation: { buildPassed: true, publicTestsPassed: success, hiddenTestsPassed: success, relevantTestsExecuted: success },
    changedFiles: success ? ["src/a.ts"] : [],
    metrics: { agentTurns: 8, toolCalls: 8, latencyMs: 1000, inputTokens: 100, outputTokens: 10, totalTokens: 110, ...overrides },
    evidence: {
      trajectory: { turns: [], toolCallCount: 0, stopReason: success ? "completed" : "max_turns", terminationDetail: null, finalAssistantMessage: null, totalUsage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } },
      diff: "",
      evaluatorRaw: {},
      sandbox: { runner: "token-factory", handleId: "h" },
    },
  };
}

test("classifyStability: fewer than minRuns is always unstable, regardless of agreement", () => {
  assert.equal(classifyStability(0, 0, 2), "unstable");
  assert.equal(classifyStability(1, 0, 2), "unstable");
  assert.equal(classifyStability(0, 1, 2), "unstable");
});

test("classifyStability: clean agreement at minRuns resolves immediately", () => {
  assert.equal(classifyStability(2, 0, 2), "mostly_pass");
  assert.equal(classifyStability(0, 2, 2), "mostly_fail");
  assert.equal(classifyStability(3, 0, 2), "mostly_pass");
  assert.equal(classifyStability(0, 3, 2), "mostly_fail");
});

test("classifyStability: exact 50/50 split is unstable", () => {
  assert.equal(classifyStability(1, 1, 2), "unstable");
});

test("classifyStability: 1/3 and 2/3 splits are deliberately kept unstable, not rounded into a verdict", () => {
  // 2 pass / 1 fail = 33.3% failure rate, strictly greater than the 0.33 safe threshold.
  assert.equal(classifyStability(2, 1, 2), "unstable");
  // 1 pass / 2 fail = 66.7% failure rate, strictly less than the 0.67 regressing threshold.
  assert.equal(classifyStability(1, 2, 2), "unstable");
});

test("needsMoreRuns: always requires reaching minRuns first, even with a single agreeing run", () => {
  assert.equal(needsMoreRuns(0, 0, 2, 3), true);
  assert.equal(needsMoreRuns(1, 0, 2, 3), true);
  assert.equal(needsMoreRuns(0, 1, 2, 3), true);
});

test("needsMoreRuns: stops at minRuns once the evidence already agrees", () => {
  assert.equal(needsMoreRuns(2, 0, 2, 3), false);
  assert.equal(needsMoreRuns(0, 2, 2, 3), false);
});

test("needsMoreRuns: requests one more run (up to maxRuns) when minRuns disagree", () => {
  assert.equal(needsMoreRuns(1, 1, 2, 3), true);
});

test("needsMoreRuns: never exceeds maxRuns, even if still unstable there", () => {
  assert.equal(needsMoreRuns(2, 1, 2, 3), false);
  assert.equal(needsMoreRuns(1, 2, 2, 3), false);
});

test("aggregateOutcome: mostly_pass/mostly_fail map to true/false, unstable maps to null (no evidence)", () => {
  assert.equal(aggregateOutcome("mostly_pass"), true);
  assert.equal(aggregateOutcome("mostly_fail"), false);
  assert.equal(aggregateOutcome("unstable"), null);
});

test("buildAggregate: computes pass/fail counts, rates, termination reasons, and per-run means without discarding individual runs", () => {
  const runs = [
    fakeResult(true, "a", { inputTokens: 100, outputTokens: 10, latencyMs: 1000 }),
    fakeResult(false, "a", { inputTokens: 200, outputTokens: 20, latencyMs: 2000 }),
    fakeResult(false, "a", { inputTokens: 300, outputTokens: 30, latencyMs: 3000 }),
  ];
  const agg = buildAggregate("01", { skills: "baseline", contextPolicy: "candidate" }, "contextPolicy=candidate", runs, 2);

  assert.deepEqual(agg.runs, runs, "individual run evidence is preserved, not discarded");
  assert.notEqual(agg.runs, runs, "the aggregate must snapshot a COPY of the runs array, not the caller's live/still-mutating reference");
  assert.equal(agg.passCount, 1);
  assert.equal(agg.failCount, 2);
  assert.equal(agg.passRate, 1 / 3);
  assert.equal(agg.failureRate, 2 / 3);
  assert.deepEqual(agg.terminationReasons, { completed: 1, max_turns: 2 });
  assert.equal(agg.meanInputTokens, 200);
  assert.equal(agg.meanOutputTokens, 20);
  assert.equal(agg.meanLatencyMs, 2000);
  assert.equal(agg.stability, "unstable"); // 2/3 failure rate, per the deliberate threshold gap
});

function aggregateOf(
  bits: string,
  configuration: ConfigurationAggregate["configuration"],
  label: string,
  stability: ConfigurationAggregate["stability"],
  failureRate = 0,
  passCount = 0,
  failCount = 0,
): ConfigurationAggregate {
  return {
    configurationVector: bits,
    configuration,
    label,
    runs: [],
    passCount,
    failCount,
    passRate: 1 - failureRate,
    failureRate,
    terminationReasons: {},
    meanInputTokens: 0,
    meanOutputTokens: 0,
    meanLatencyMs: 0,
    stability,
    evidenceMaturity: stability === "unstable" ? "unstable" : "replicated",
    isDecisionCritical: false,
  };
}

test("evaluateAggregateHypotheses: decisive aggregates resolve a main effect exactly like Milestone 6's single-run model", () => {
  const aggregates = [
    aggregateOf("00", { skills: "baseline", contextPolicy: "baseline" }, "baseline", "mostly_pass"),
    aggregateOf("11", { skills: "candidate", contextPolicy: "candidate" }, "candidate", "mostly_fail", 1),
    aggregateOf("10", { skills: "candidate", contextPolicy: "baseline" }, "isolate-skills", "mostly_fail", 1),
  ];
  const hypotheses = evaluateAggregateHypotheses(DIMS2, aggregates);
  const remaining = hypotheses.filter((h) => h.status !== "rejected");
  assert.equal(remaining.length, 1);
  assert.deepEqual(remaining[0].factors, ["skills"]);
});

test("evaluateAggregateHypotheses: an unstable aggregate contributes no evidence for or against any hypothesis", () => {
  const decisiveOnly = [
    aggregateOf("00", { skills: "baseline", contextPolicy: "baseline" }, "baseline", "mostly_pass"),
    aggregateOf("11", { skills: "candidate", contextPolicy: "candidate" }, "candidate", "mostly_fail", 1),
  ];
  const withUnstableCell = [...decisiveOnly, aggregateOf("10", { skills: "candidate", contextPolicy: "baseline" }, "isolate-skills", "unstable", 0.5)];

  const withoutUnstable = evaluateAggregateHypotheses(DIMS2, decisiveOnly);
  const withUnstable = evaluateAggregateHypotheses(DIMS2, withUnstableCell);

  // Adding a genuinely unstable cell must never reject a hypothesis that wasn't already rejected by decisive evidence alone.
  for (const h of withoutUnstable) {
    const same = withUnstable.find((h2) => h2.id === h.id)!;
    if (h.status === "rejected") assert.equal(same.status, "rejected");
  }
  // And it must not manufacture a false "supported" verdict either: both main effects and the interaction
  // remain possible until the isolate-skills cell actually resolves.
  const remaining = withUnstable.filter((h) => h.status !== "rejected");
  assert.equal(remaining.length, 3);
});

test("evaluateAggregateHypotheses: a decisively-resolved interaction cell resolves to the interaction hypothesis", () => {
  const aggregates = [
    aggregateOf("00", { skills: "baseline", contextPolicy: "baseline" }, "baseline", "mostly_pass"),
    aggregateOf("11", { skills: "candidate", contextPolicy: "candidate" }, "candidate", "mostly_fail", 1),
    aggregateOf("10", { skills: "candidate", contextPolicy: "baseline" }, "isolate-skills", "mostly_pass"),
    aggregateOf("01", { skills: "baseline", contextPolicy: "candidate" }, "isolate-context", "mostly_pass"),
  ];
  const hypotheses = evaluateAggregateHypotheses(DIMS2, aggregates);
  const remaining = hypotheses.filter((h) => h.status !== "rejected");
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].type, "interaction");
});

// --- Milestone 8: evidence maturity, provisional lean, decision criticality ---

test("computeEvidenceMaturity: fewer than minRuns is always 'provisional', regardless of the single outcome", () => {
  assert.equal(computeEvidenceMaturity(0, 2, "unstable"), "provisional");
  assert.equal(computeEvidenceMaturity(1, 2, "unstable"), "provisional");
});

test("computeEvidenceMaturity: >= minRuns with a decisive stability is 'replicated'", () => {
  assert.equal(computeEvidenceMaturity(2, 2, "mostly_pass"), "replicated");
  assert.equal(computeEvidenceMaturity(2, 2, "mostly_fail"), "replicated");
  assert.equal(computeEvidenceMaturity(3, 2, "mostly_pass"), "replicated");
});

test("computeEvidenceMaturity: >= minRuns but genuinely disagreeing is 'unstable', distinct from 'provisional'", () => {
  assert.equal(computeEvidenceMaturity(2, 2, "unstable"), "unstable");
  assert.equal(computeEvidenceMaturity(3, 2, "unstable"), "unstable");
});

test("provisionalOutcome: a single run is trivially unanimous (its own outcome), never tied", () => {
  assert.equal(provisionalOutcome({ passCount: 1, failCount: 0 }), true);
  assert.equal(provisionalOutcome({ passCount: 0, failCount: 1 }), false);
});

test("provisionalOutcome: majority lean once there are more runs, even if `stability` would still call it unstable", () => {
  // 2 pass / 1 fail: classifyStability(2,1,2) is "unstable" (see the 1/3 threshold gap), but the
  // PROVISIONAL layer still has a usable majority lean toward PASS.
  assert.equal(provisionalOutcome({ passCount: 2, failCount: 1 }), true);
  assert.equal(provisionalOutcome({ passCount: 1, failCount: 2 }), false);
});

test("provisionalOutcome: an exact tie (including 0/0) has no lean at all", () => {
  assert.equal(provisionalOutcome({ passCount: 0, failCount: 0 }), null);
  assert.equal(provisionalOutcome({ passCount: 1, failCount: 1 }), null);
});

test("decisionCriticality: 0 when a configuration's prediction doesn't distinguish any pair of hypotheses", () => {
  const [main1] = buildHypothesisSpace(["skills"]);
  assert.equal(decisionCriticality({ skills: "baseline" }, [main1]), 0, "a single hypothesis has no pairs to separate");
});

test("decisionCriticality: 1 for the literal isolating contrast between exactly two disagreeing hypotheses", () => {
  const space = buildHypothesisSpace(DIMS2); // main:skills, main:contextPolicy, interaction
  const mainSkills = space.find((h) => h.id === "main_effect:skills")!;
  const interaction = space.find((h) => h.type === "interaction")!;
  // skills=candidate, contextPolicy=baseline: main:skills predicts FAIL, interaction predicts PASS (not both candidate) -> disagree.
  assert.equal(decisionCriticality({ skills: "candidate", contextPolicy: "baseline" }, [mainSkills, interaction]), 1);
  // skills=baseline, contextPolicy=baseline: both predict PASS -> agree, criticality 0.
  assert.equal(decisionCriticality({ skills: "baseline", contextPolicy: "baseline" }, [mainSkills, interaction]), 0);
});

test("decisionCriticality: counts every disagreeing pair among more than two hypotheses", () => {
  const space = buildHypothesisSpace(DIMS2); // 3 hypotheses total: C(3,2)=3 possible pairs
  // skills=candidate, contextPolicy=baseline: main:skills->FAIL, main:contextPolicy->PASS, interaction->PASS.
  // Disagreeing pairs: (main:skills, main:contextPolicy) and (main:skills, interaction) = 2. (main:contextPolicy, interaction) agree.
  assert.equal(decisionCriticality({ skills: "candidate", contextPolicy: "baseline" }, space), 2);
});

test("evaluateProvisionalHypotheses: a single-run 'provisional' aggregate DOES narrow the provisional-remaining set", () => {
  const aggregates = [
    aggregateOf("00", { skills: "baseline", contextPolicy: "baseline" }, "baseline", "mostly_pass", 0, 2, 0),
    aggregateOf("11", { skills: "candidate", contextPolicy: "candidate" }, "candidate", "mostly_fail", 1, 0, 2),
    // Single run, provisional: passCount=1, failCount=0 -> provisionalOutcome=true (lean PASS), even though
    // classifyStability(1,0,2) would be "unstable" (insufficient) and contributes nothing to the CONFIRMED layer.
    { ...aggregateOf("10", { skills: "candidate", contextPolicy: "baseline" }, "isolate-skills", "unstable", 0, 1, 0), evidenceMaturity: "provisional" as const },
  ];

  const confirmed = evaluateAggregateHypotheses(DIMS2, aggregates);
  const provisional = evaluateProvisionalHypotheses(DIMS2, aggregates);

  // Confirmed layer: the single-run "10" aggregate contributes nothing -> all 3 hypotheses still possible.
  assert.equal(confirmed.filter((h) => h.status !== "rejected").length, 3);

  // Provisional layer: "10" leans PASS (skills=candidate, contextPolicy=baseline observed PASS), which
  // contradicts main_effect:skills (predicts FAIL there) -> provisionally rejected, narrowing to 2.
  const provisionalRemaining = provisional.filter((h) => h.status !== "rejected");
  assert.equal(provisionalRemaining.length, 2);
  assert.ok(!provisionalRemaining.some((h) => h.id === "main_effect:skills"));
});

test("evaluateProvisionalHypotheses: a later run overturning a single-run lean is not a permanent erasure — it can return to 'possible'", () => {
  const afterOneRun = [
    aggregateOf("00", { skills: "baseline", contextPolicy: "baseline" }, "baseline", "mostly_pass", 0, 2, 0),
    aggregateOf("11", { skills: "candidate", contextPolicy: "candidate" }, "candidate", "mostly_fail", 1, 0, 2),
    { ...aggregateOf("10", { skills: "candidate", contextPolicy: "baseline" }, "isolate-skills", "unstable", 0, 1, 0), evidenceMaturity: "provisional" as const },
  ];
  const provisionalRejectedFirst = evaluateProvisionalHypotheses(DIMS2, afterOneRun).find((h) => h.id === "main_effect:skills")!;
  assert.equal(provisionalRejectedFirst.status, "rejected");

  // A second run for "10" comes back FAIL, flipping the tally to 1 pass / 1 fail -> tied -> no lean at all.
  const afterTwoRuns = [
    afterOneRun[0],
    afterOneRun[1],
    { ...aggregateOf("10", { skills: "candidate", contextPolicy: "baseline" }, "isolate-skills", "unstable", 0.5, 1, 1), evidenceMaturity: "unstable" as const },
  ];
  const provisionalAfterTwo = evaluateProvisionalHypotheses(DIMS2, afterTwoRuns).find((h) => h.id === "main_effect:skills")!;
  assert.equal(provisionalAfterTwo.status, "possible", "the earlier provisional rejection was not permanent — new evidence un-rejected it");
});
