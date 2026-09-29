import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyDiagnosis, selectNextExperiment } from "../src/lib/diagnosis/planner";
import { evaluateHypotheses } from "../src/lib/diagnosis/hypotheses";
import type { CellPattern, KnownCell } from "../src/lib/diagnosis/types";
import type { HarnessDimension } from "../src/lib/harness/types";

const DIMS: [HarnessDimension, HarnessDimension] = ["skills", "contextPolicy"];

function cell(label: string, configuration: CellPattern, success: boolean): KnownCell {
  return { label, configuration, success };
}
const baselineCell = cell("baseline", { skills: "baseline", contextPolicy: "baseline" }, true);
const candidateCell = cell("candidate", { skills: "candidate", contextPolicy: "candidate" }, false);

test("selectNextExperiment: 1 dimension needs no experiments at all", () => {
  assert.equal(selectNextExperiment(["skills"], [], 5), null);
});

test("selectNextExperiment: 2 dimensions, nothing known yet -> proposes isolating the first dimension", () => {
  const planned = selectNextExperiment(DIMS, [baselineCell, candidateCell], 5);
  assert.ok(planned);
  assert.deepEqual(planned!.configuration, { skills: "candidate", contextPolicy: "baseline" });
  assert.match(planned!.whySelected, /skills/);
});

test("selectNextExperiment: stops (returns null) once the first isolating experiment already fails — parsimony", () => {
  const known = [baselineCell, candidateCell, cell("isolate-skills", { skills: "candidate", contextPolicy: "baseline" }, false)];
  assert.equal(selectNextExperiment(DIMS, known, 5), null);
});

test("selectNextExperiment: proposes the second isolating experiment once the first passes", () => {
  const known = [baselineCell, candidateCell, cell("isolate-skills", { skills: "candidate", contextPolicy: "baseline" }, true)];
  const planned = selectNextExperiment(DIMS, known, 5);
  assert.ok(planned);
  assert.deepEqual(planned!.configuration, { skills: "baseline", contextPolicy: "candidate" });
  assert.match(planned!.whySelected, /contextPolicy/);
});

test("selectNextExperiment: returns null once both isolating cells are known", () => {
  const known = [
    baselineCell,
    candidateCell,
    cell("isolate-skills", { skills: "candidate", contextPolicy: "baseline" }, true),
    cell("isolate-context", { skills: "baseline", contextPolicy: "candidate" }, true),
  ];
  assert.equal(selectNextExperiment(DIMS, known, 5), null);
});

test("selectNextExperiment: budget enforcement — returns null when remainingBudget is 0", () => {
  const planned = selectNextExperiment(DIMS, [baselineCell, candidateCell], 0);
  assert.equal(planned, null);
});

test("classifyDiagnosis: main_effect when exactly one hypothesis is supported", () => {
  const known = [baselineCell, candidateCell, cell("isolate-skills", { skills: "candidate", contextPolicy: "baseline" }, false)];
  const diagnosis = classifyDiagnosis(evaluateHypotheses(DIMS, known));
  assert.deepEqual(diagnosis, { type: "main_effect", factors: ["skills"] });
});

test("classifyDiagnosis: interaction when both mains are rejected and the interaction hypothesis is supported", () => {
  const known = [
    baselineCell,
    candidateCell,
    cell("isolate-skills", { skills: "candidate", contextPolicy: "baseline" }, true),
    cell("isolate-context", { skills: "baseline", contextPolicy: "candidate" }, true),
  ];
  const diagnosis = classifyDiagnosis(evaluateHypotheses(DIMS, known));
  assert.deepEqual(diagnosis, { type: "interaction", factors: DIMS });
});

test("classifyDiagnosis: inconclusive when no hypothesis is supported yet", () => {
  const diagnosis = classifyDiagnosis(evaluateHypotheses(DIMS, [baselineCell, candidateCell]));
  assert.equal(diagnosis.type, "inconclusive");
});

test("classifyDiagnosis: inconclusive when more than one hypothesis is independently supported (ambiguous)", () => {
  const known = [
    baselineCell,
    candidateCell,
    cell("isolate-skills", { skills: "candidate", contextPolicy: "baseline" }, false),
    cell("isolate-context", { skills: "baseline", contextPolicy: "candidate" }, false),
  ];
  const diagnosis = classifyDiagnosis(evaluateHypotheses(DIMS, known));
  assert.equal(diagnosis.type, "inconclusive");
});
