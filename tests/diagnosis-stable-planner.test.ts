import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHypothesisSpace } from "../src/lib/diagnosis/hypotheses";
import { selectNextAction } from "../src/lib/diagnosis/stable-planner";
import type { ConfigurationAggregate, ReplicationPolicy } from "../src/lib/diagnosis/types";
import type { HarnessDimension } from "../src/lib/harness/types";

const DIMS2: [HarnessDimension, HarnessDimension] = ["skills", "contextPolicy"];
const POLICY: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 10 };

function aggregateOf(bits: string, configuration: ConfigurationAggregate["configuration"], stability: ConfigurationAggregate["stability"], runCount: number): ConfigurationAggregate {
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
  };
}

test("selectNextAction: returns null once at most one hypothesis remains", () => {
  const single = buildHypothesisSpace(["skills"]);
  assert.equal(selectNextAction(["skills"], single, [], POLICY, 5), null);
  assert.equal(selectNextAction(["skills"], [], [], POLICY, 5), null);
});

test("selectNextAction: returns null when remainingRunBudget is 0", () => {
  const hypotheses = buildHypothesisSpace(DIMS2);
  assert.equal(selectNextAction(DIMS2, hypotheses, [], POLICY, 0), null);
});

test("selectNextAction: with nothing tested yet, chooses a new configuration", () => {
  const hypotheses = buildHypothesisSpace(DIMS2);
  const baseline = aggregateOf("00", { skills: "baseline", contextPolicy: "baseline" }, "mostly_pass", 2);
  const candidate = aggregateOf("11", { skills: "candidate", contextPolicy: "candidate" }, "mostly_fail", 2);
  const planned = selectNextAction(DIMS2, hypotheses, [baseline, candidate], POLICY, 5);
  assert.ok(planned);
  assert.equal(planned!.action, "new_configuration");
  assert.ok(["01", "10"].includes(planned!.bits));
});

test("selectNextAction: replicates a decisive-but-unstable tested configuration instead of trying something new", () => {
  const hypotheses = buildHypothesisSpace(DIMS2);
  const baseline = aggregateOf("00", { skills: "baseline", contextPolicy: "baseline" }, "mostly_pass", 2);
  const candidate = aggregateOf("11", { skills: "candidate", contextPolicy: "candidate" }, "mostly_fail", 2);
  // isolate-skills ("10") is unstable after 2 runs and still under maxRuns=3, and it's decisive
  // (it's the exact cell that would distinguish main_effect:skills / main_effect:contextPolicy / interaction).
  const unstable = aggregateOf("10", { skills: "candidate", contextPolicy: "baseline" }, "unstable", 2);
  const planned = selectNextAction(DIMS2, hypotheses, [baseline, candidate, unstable], POLICY, 5);
  assert.ok(planned);
  assert.equal(planned!.action, "replicate");
  assert.equal(planned!.bits, "10");
  assert.match(planned!.whySelected, /unstable/i);
});

test("selectNextAction: does NOT replicate an unstable configuration that has already hit maxRunsPerConfiguration", () => {
  const hypotheses = buildHypothesisSpace(DIMS2);
  const baseline = aggregateOf("00", { skills: "baseline", contextPolicy: "baseline" }, "mostly_pass", 2);
  const candidate = aggregateOf("11", { skills: "candidate", contextPolicy: "candidate" }, "mostly_fail", 2);
  const exhausted = aggregateOf("10", { skills: "candidate", contextPolicy: "baseline" }, "unstable", 3); // already at maxRuns
  const planned = selectNextAction(DIMS2, hypotheses, [baseline, candidate, exhausted], POLICY, 5);
  assert.ok(planned);
  assert.equal(planned!.action, "new_configuration");
  assert.equal(planned!.bits, "01", "the only remaining untested configuration");
});

test("selectNextAction: does NOT replicate an unstable configuration that is irrelevant to the remaining hypotheses", () => {
  const hypotheses = buildHypothesisSpace(DIMS2).map((h) =>
    h.id === "interaction:skills+contextPolicy" ? { ...h, status: "rejected" as const } : h,
  );
  const remaining = hypotheses.filter((h) => h.status !== "rejected"); // main_effect:skills, main_effect:contextPolicy
  const baseline = aggregateOf("00", { skills: "baseline", contextPolicy: "baseline" }, "mostly_pass", 2);
  const candidate = aggregateOf("11", { skills: "candidate", contextPolicy: "candidate" }, "mostly_fail", 2);
  // Both remaining hypotheses predict the SAME outcome (FAIL) for "10" (skills=candidate alone triggers
  // main_effect:skills; contextPolicy=baseline means main_effect:contextPolicy predicts PASS — wait, they
  // actually disagree here, so use "01" instead, where main_effect:skills predicts PASS and
  // main_effect:contextPolicy predicts FAIL — that DOES discriminate). Use a genuinely non-discriminating
  // cell: none exists among 2 dimensions once the interaction is rejected, so assert no replicate happens
  // when informationScore would be 0 by construction (both mains agree on "00" and "11" already, and any
  // other unstable cell not in play should simply be skipped in favor of picking a new configuration).
  const irrelevantUnstable = aggregateOf("00", { skills: "baseline", contextPolicy: "baseline" }, "unstable", 2);
  const planned = selectNextAction(DIMS2, remaining, [baseline, candidate, irrelevantUnstable], POLICY, 5);
  assert.ok(planned);
  assert.equal(planned!.action, "new_configuration");
});

test("selectNextAction: prefers the highest-information replicate target when multiple unstable configurations are pending", () => {
  const dims: HarnessDimension[] = ["skills", "contextPolicy", "systemPrompt"];
  const hypotheses = buildHypothesisSpace(dims);
  const baseline = aggregateOf("000", { skills: "baseline", contextPolicy: "baseline", systemPrompt: "baseline" }, "mostly_pass", 2);
  const candidate = aggregateOf("111", { skills: "candidate", contextPolicy: "candidate", systemPrompt: "candidate" }, "mostly_fail", 2);
  // "100" only disagrees with 1 of the 6 hypotheses' predictions (informationScore=1).
  const lowInfo = aggregateOf("100", { skills: "candidate", contextPolicy: "baseline", systemPrompt: "baseline" }, "unstable", 2);
  // "110" splits the 6 hypotheses 3/3 (informationScore=3) — strictly more informative.
  const highInfo = aggregateOf("110", { skills: "candidate", contextPolicy: "candidate", systemPrompt: "baseline" }, "unstable", 2);
  const planned = selectNextAction(dims, hypotheses, [baseline, candidate, lowInfo, highInfo], POLICY, 5);
  assert.ok(planned);
  assert.equal(planned!.action, "replicate");
  assert.equal(planned!.bits, "110");
  assert.equal(planned!.informationScore, 3);
});
