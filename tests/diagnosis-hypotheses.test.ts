import assert from "node:assert/strict";
import { test } from "node:test";
import { bitsToConfiguration, buildHypothesisSpace, configurationToBits, evaluateHypotheses, predict, UnsupportedDiagnosisScopeError } from "../src/lib/diagnosis/hypotheses";
import type { CellPattern, DiagnosisHypothesis, KnownCell } from "../src/lib/diagnosis/types";
import type { HarnessDimension } from "../src/lib/harness/types";

const DIMS2: [HarnessDimension, HarnessDimension] = ["skills", "contextPolicy"];
const DIMS4: [HarnessDimension, HarnessDimension, HarnessDimension, HarnessDimension] = ["skills", "contextPolicy", "systemPrompt", "execution.maxTurns"];

function cell(label: string, bits: string, configuration: CellPattern, success: boolean): KnownCell {
  return { label, bits, configuration, success };
}

test("configurationToBits/bitsToConfiguration round-trip for 1-4 dimensions", () => {
  for (const dims of [["skills"], DIMS2, DIMS4] as HarnessDimension[][]) {
    const total = 2 ** dims.length;
    for (let n = 0; n < total; n++) {
      const bits = n.toString(2).padStart(dims.length, "0");
      const configuration = bitsToConfiguration(bits, dims);
      assert.equal(configurationToBits(configuration, dims), bits, `round-trip failed for dims=${dims.join(",")} bits=${bits}`);
    }
  }
});

test("configurationToBits: baseline is all zeros, candidate is all ones, in stable dimension order", () => {
  const baseline: CellPattern = { skills: "baseline", contextPolicy: "baseline", systemPrompt: "baseline", "execution.maxTurns": "baseline" };
  const candidate: CellPattern = { skills: "candidate", contextPolicy: "candidate", systemPrompt: "candidate", "execution.maxTurns": "candidate" };
  assert.equal(configurationToBits(baseline, DIMS4), "0000");
  assert.equal(configurationToBits(candidate, DIMS4), "1111");
});

test("buildHypothesisSpace: 1 dimension -> 1 main effect, no interactions", () => {
  const space = buildHypothesisSpace(["skills"]);
  assert.equal(space.length, 1);
  assert.equal(space[0].type, "main_effect");
});

test("buildHypothesisSpace: 2 dimensions -> 2 main effects + 1 interaction = 3", () => {
  const space = buildHypothesisSpace(DIMS2);
  assert.equal(space.filter((h) => h.type === "main_effect").length, 2);
  assert.equal(space.filter((h) => h.type === "interaction").length, 1);
  assert.equal(space.length, 3);
});

test("buildHypothesisSpace: 4 dimensions -> 4 main effects + 6 pairwise interactions = 10, no 3-way/4-way", () => {
  const space = buildHypothesisSpace(DIMS4);
  const mains = space.filter((h) => h.type === "main_effect");
  const interactions = space.filter((h) => h.type === "interaction");
  assert.equal(mains.length, 4);
  assert.equal(interactions.length, 6);
  assert.equal(space.length, 10);
  assert.ok(interactions.every((h) => h.factors.length === 2), "only pairwise interactions are ever generated");
  const pairIds = new Set(interactions.map((h) => h.factors.slice().sort().join("+")));
  assert.equal(pairIds.size, 6, "all 6 unordered pairs are distinct");
});

test("buildHypothesisSpace throws UnsupportedDiagnosisScopeError for 0 or 5+ dimensions", () => {
  assert.throws(() => buildHypothesisSpace([]), UnsupportedDiagnosisScopeError);
  assert.throws(() => buildHypothesisSpace(["model", "systemPrompt", "skills", "contextPolicy", "execution.maxTurns"]), UnsupportedDiagnosisScopeError);
});

test("predict: main effect predicts FAIL iff its own factor is at candidate, regardless of every other factor", () => {
  const h: DiagnosisHypothesis = { id: "main_effect:skills", factors: ["skills"], type: "main_effect", status: "possible", evidenceFor: [], evidenceAgainst: [] };
  assert.equal(predict(h, { skills: "baseline" }), true);
  assert.equal(predict(h, { skills: "baseline", contextPolicy: "candidate", systemPrompt: "candidate", "execution.maxTurns": "candidate" }), true);
  assert.equal(predict(h, { skills: "candidate" }), false);
  assert.equal(predict(h, { skills: "candidate", contextPolicy: "baseline", systemPrompt: "baseline", "execution.maxTurns": "baseline" }), false);
});

test("predict: pairwise interaction predicts FAIL only when BOTH factors are at candidate; other factors never matter", () => {
  const h: DiagnosisHypothesis = {
    id: "interaction:skills+contextPolicy",
    factors: ["skills", "contextPolicy"],
    type: "interaction",
    status: "possible",
    evidenceFor: [],
    evidenceAgainst: [],
  };
  assert.equal(predict(h, { skills: "baseline", contextPolicy: "baseline" }), true);
  assert.equal(predict(h, { skills: "candidate", contextPolicy: "baseline" }), true);
  assert.equal(predict(h, { skills: "baseline", contextPolicy: "candidate" }), true);
  assert.equal(predict(h, { skills: "candidate", contextPolicy: "candidate" }), false);
  // other, unrelated factors never change the prediction either way
  assert.equal(predict(h, { skills: "candidate", contextPolicy: "baseline", systemPrompt: "candidate", "execution.maxTurns": "candidate" }), true);
  assert.equal(predict(h, { skills: "candidate", contextPolicy: "candidate", systemPrompt: "baseline", "execution.maxTurns": "baseline" }), false);
});

test("evaluateHypotheses: 1 changed dimension resolves immediately from the candidate cell alone", () => {
  const known = [cell("candidate", "1", { skills: "candidate" }, false)];
  const hypotheses = evaluateHypotheses(["skills"], known);
  assert.equal(hypotheses.length, 1);
  assert.equal(hypotheses[0].status, "supported");
  assert.equal(hypotheses[0].type, "main_effect");
  assert.deepEqual(hypotheses[0].factors, ["skills"]);
});

test("evaluateHypotheses: 2 dimensions, no diagnostic cells yet -> everything possible", () => {
  const hypotheses = evaluateHypotheses(DIMS2, []);
  assert.equal(hypotheses.length, 3);
  assert.ok(hypotheses.every((h) => h.status === "possible"));
});

test("synthetic (4-dim): a single main effect fails, everything else is a benign distractor -> resolves to that main effect", () => {
  const known: KnownCell[] = [
    cell("baseline", "0000", { skills: "baseline", contextPolicy: "baseline", systemPrompt: "baseline", "execution.maxTurns": "baseline" }, true),
    cell("candidate", "1111", { skills: "candidate", contextPolicy: "candidate", systemPrompt: "candidate", "execution.maxTurns": "candidate" }, false),
    // isolate skills alone: fails -> skills main effect looks responsible
    cell("isolate-skills", "1000", { skills: "candidate", contextPolicy: "baseline", systemPrompt: "baseline", "execution.maxTurns": "baseline" }, false),
  ];
  const hypotheses = evaluateHypotheses(DIMS4, known);
  const remaining = hypotheses.filter((h) => h.status !== "rejected");
  assert.equal(remaining.length, 1);
  assert.deepEqual(remaining[0].factors, ["skills"]);
  assert.equal(remaining[0].status, "supported");
});

test("synthetic (4-dim): only the skills+contextPolicy pair fails together -> resolves to that pairwise interaction, distractors excluded", () => {
  const known: KnownCell[] = [
    cell("baseline", "0000", { skills: "baseline", contextPolicy: "baseline", systemPrompt: "baseline", "execution.maxTurns": "baseline" }, true),
    cell("candidate", "1111", { skills: "candidate", contextPolicy: "candidate", systemPrompt: "candidate", "execution.maxTurns": "candidate" }, false),
    cell("isolate-skills", "1000", { skills: "candidate", contextPolicy: "baseline", systemPrompt: "baseline", "execution.maxTurns": "baseline" }, true),
    cell("isolate-context", "0100", { skills: "baseline", contextPolicy: "candidate", systemPrompt: "baseline", "execution.maxTurns": "baseline" }, true),
    cell("skills+context-together", "1100", { skills: "candidate", contextPolicy: "candidate", systemPrompt: "baseline", "execution.maxTurns": "baseline" }, false),
  ];
  const hypotheses = evaluateHypotheses(DIMS4, known);
  const remaining = hypotheses.filter((h) => h.status !== "rejected");
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].type, "interaction");
  assert.deepEqual(remaining[0].factors.slice().sort(), ["contextPolicy", "skills"]);
});

test("synthetic (4-dim): evidence generated by a true 3-way interaction rejects every main-effect/pairwise hypothesis -> inconclusive by construction", () => {
  // Ground truth (not representable in this model): only skills=C AND contextPolicy=C AND systemPrompt=C together fail;
  // every single factor and every pair, alone, passes. execution.maxTurns never matters. No main-effect or pairwise
  // hypothesis in the model can fit this, so every one of the 10 must end up rejected.
  const configOf = (bits: string) => bitsToConfiguration(bits, DIMS4);
  const known: KnownCell[] = [
    cell("baseline", "0000", configOf("0000"), true),
    cell("candidate", "1111", configOf("1111"), false),
    cell("triple-skills-context-prompt", "1110", configOf("1110"), false), // the true 3-way combination, maxTurns irrelevant
    cell("pair-skills-context", "1100", configOf("1100"), true),
    cell("pair-skills-prompt", "1010", configOf("1010"), true),
    cell("pair-context-prompt", "0110", configOf("0110"), true),
    cell("pair-skills-maxturns", "1001", configOf("1001"), true),
    cell("pair-context-maxturns", "0101", configOf("0101"), true),
    cell("pair-prompt-maxturns", "0011", configOf("0011"), true),
    cell("maxturns-alone", "0001", configOf("0001"), true),
  ];
  const hypotheses = evaluateHypotheses(DIMS4, known);
  const remaining = hypotheses.filter((h) => h.status !== "rejected");
  assert.equal(remaining.length, 0, "a genuine 3-way interaction rejects every main-effect/pairwise hypothesis in the model");
  assert.ok(hypotheses.every((h) => h.status === "rejected"));
});

test("evaluateHypotheses throws UnsupportedDiagnosisScopeError for 0 or 5+ changed dimensions", () => {
  assert.throws(() => evaluateHypotheses([], []), UnsupportedDiagnosisScopeError);
  assert.throws(() => evaluateHypotheses(["model", "systemPrompt", "skills", "contextPolicy", "execution.maxTurns"], []), UnsupportedDiagnosisScopeError);
});
