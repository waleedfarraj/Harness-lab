import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyDiagnosis, scoreConfiguration, selectNextExperiment } from "../src/lib/diagnosis/planner";
import { bitsToConfiguration, buildHypothesisSpace, evaluateHypotheses } from "../src/lib/diagnosis/hypotheses";
import type { CellPattern, DiagnosisHypothesis, KnownCell } from "../src/lib/diagnosis/types";
import type { HarnessDimension } from "../src/lib/harness/types";

const DIMS2: [HarnessDimension, HarnessDimension] = ["skills", "contextPolicy"];
const DIMS4: [HarnessDimension, HarnessDimension, HarnessDimension, HarnessDimension] = ["skills", "contextPolicy", "systemPrompt", "execution.maxTurns"];

function cell(label: string, bits: string, configuration: CellPattern, success: boolean): KnownCell {
  return { label, bits, configuration, success };
}
const baselineCell2 = cell("baseline", "00", { skills: "baseline", contextPolicy: "baseline" }, true);
const candidateCell2 = cell("candidate", "11", { skills: "candidate", contextPolicy: "candidate" }, false);

test("scoreConfiguration: counts how many remaining hypotheses predict PASS vs FAIL; informationScore is the balanced-split minimum", () => {
  const hypotheses = buildHypothesisSpace(DIMS2); // main:skills, main:contextPolicy, interaction:skills+contextPolicy
  const config: CellPattern = { skills: "candidate", contextPolicy: "baseline" };
  // main:skills predicts FAIL (skills=candidate); main:contextPolicy predicts PASS; interaction predicts PASS (not both candidate)
  const score = scoreConfiguration(config, hypotheses);
  assert.equal(score.predictedFail, 1);
  assert.equal(score.predictedPass, 2);
  assert.equal(score.informationScore, 1);
});

test("selectNextExperiment: returns null once at most one hypothesis remains", () => {
  const single: DiagnosisHypothesis[] = [{ id: "main_effect:skills", factors: ["skills"], type: "main_effect", status: "possible", evidenceFor: [], evidenceAgainst: [] }];
  assert.equal(selectNextExperiment(["skills"], single, new Set(), 5), null);
  assert.equal(selectNextExperiment(["skills"], [], new Set(), 5), null);
});

test("selectNextExperiment: returns null when remainingBudget is 0", () => {
  const hypotheses = buildHypothesisSpace(DIMS2);
  assert.equal(selectNextExperiment(DIMS2, hypotheses, new Set(), 0), null);
});

test("selectNextExperiment: 2 dimensions, full hypothesis space -> proposes an isolating configuration with a balanced predicted split", () => {
  const hypotheses = buildHypothesisSpace(DIMS2);
  const planned = selectNextExperiment(DIMS2, hypotheses, new Set(["00", "11"]), 5);
  assert.ok(planned);
  // Only "10" and "01" are untested; both split the 3 hypotheses 1 FAIL / 2 PASS, informationScore=1.
  assert.ok(["10", "01"].includes(planned!.bits));
  assert.equal(planned!.informationScore, 1);
  assert.match(planned!.whySelected, /remaining hypotheses/);
});

test("selectNextExperiment: deterministic tie-breaking picks the lexicographically smallest bit string among equal-score candidates", () => {
  const hypotheses = buildHypothesisSpace(DIMS2);
  const planned = selectNextExperiment(DIMS2, hypotheses, new Set(["00", "11"]), 5);
  // "01" < "10" lexicographically; both have informationScore 1, so "01" must win.
  assert.equal(planned!.bits, "01");
});

test("selectNextExperiment: never selects a configuration already in testedBits", () => {
  const hypotheses = buildHypothesisSpace(DIMS4);
  const tested = new Set<string>();
  const seen = new Set<string>();
  const remaining = hypotheses;
  let budget = 20;
  while (budget > 0) {
    const planned = selectNextExperiment(DIMS4, remaining, tested, budget);
    if (!planned) break;
    assert.ok(!tested.has(planned.bits), `re-selected an already-tested configuration: ${planned.bits}`);
    assert.ok(!seen.has(planned.bits));
    seen.add(planned.bits);
    tested.add(planned.bits);
    budget -= 1;
    // Simulate this configuration passing, to keep the loop moving without resolving early.
    if (remaining.length <= 1) break;
  }
  assert.ok(seen.size > 1, "exercised more than one distinct configuration across repeated calls");
});

test("selectNextExperiment: exhausts all 14 non-baseline/candidate configurations for 4 dimensions before returning null", () => {
  const hypotheses = buildHypothesisSpace(DIMS4);
  const tested = new Set<string>(["0000", "1111"]);
  let count = 0;
  for (let i = 0; i < 20; i++) {
    const planned = selectNextExperiment(DIMS4, hypotheses, tested, 20);
    if (!planned) break;
    tested.add(planned.bits);
    count += 1;
  }
  assert.equal(count, 14, "2^4 - 2 (baseline, candidate) = 14 distinguishable configurations");
});

test("classifyDiagnosis: main_effect when exactly one hypothesis is supported", () => {
  const known = [baselineCell2, candidateCell2, cell("isolate-skills", "10", { skills: "candidate", contextPolicy: "baseline" }, false)];
  const diagnosis = classifyDiagnosis(evaluateHypotheses(DIMS2, known));
  assert.deepEqual(diagnosis, { type: "main_effect", factors: ["skills"] });
});

test("classifyDiagnosis: interaction when both mains are rejected and the interaction hypothesis is supported", () => {
  const known = [
    baselineCell2,
    candidateCell2,
    cell("isolate-skills", "10", { skills: "candidate", contextPolicy: "baseline" }, true),
    cell("isolate-context", "01", { skills: "baseline", contextPolicy: "candidate" }, true),
  ];
  const diagnosis = classifyDiagnosis(evaluateHypotheses(DIMS2, known));
  assert.deepEqual(diagnosis, { type: "interaction", factors: DIMS2 });
});

test("classifyDiagnosis: inconclusive (multiple remaining) when no hypothesis is uniquely supported yet", () => {
  const diagnosis = classifyDiagnosis(evaluateHypotheses(DIMS2, [baselineCell2, candidateCell2]));
  assert.equal(diagnosis.type, "inconclusive");
  assert.match((diagnosis as { reason: string }).reason, /hypotheses remain/);
});

test("classifyDiagnosis: inconclusive (zero remaining) when every hypothesis is rejected -- higher-order case", () => {
  const emptySpace: DiagnosisHypothesis[] = buildHypothesisSpace(DIMS2).map((h) => ({ ...h, status: "rejected" as const }));
  const diagnosis = classifyDiagnosis(emptySpace);
  assert.equal(diagnosis.type, "inconclusive");
  assert.match((diagnosis as { reason: string }).reason, /higher-order/);
});

test("bitsToConfiguration used together with the planner produces configurations selectNextExperiment can actually score", () => {
  const hypotheses = buildHypothesisSpace(DIMS4);
  const planned = selectNextExperiment(DIMS4, hypotheses, new Set(["0000", "1111"]), 5);
  assert.ok(planned);
  assert.deepEqual(planned!.configuration, bitsToConfiguration(planned!.bits, DIMS4));
});
