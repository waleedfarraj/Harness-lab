import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateOutcome, buildAggregate, classifyStability, evaluateAggregateHypotheses, needsMoreRuns } from "../src/lib/diagnosis/stability";
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

function aggregateOf(bits: string, configuration: ConfigurationAggregate["configuration"], label: string, stability: ConfigurationAggregate["stability"], failureRate = 0): ConfigurationAggregate {
  return {
    configurationVector: bits,
    configuration,
    label,
    runs: [],
    passCount: 0,
    failCount: 0,
    passRate: 1 - failureRate,
    failureRate,
    terminationReasons: {},
    meanInputTokens: 0,
    meanOutputTokens: 0,
    meanLatencyMs: 0,
    stability,
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
