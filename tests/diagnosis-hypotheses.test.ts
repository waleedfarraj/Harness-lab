import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateHypotheses,
  isIsolating,
  isolationConfiguration,
  UnsupportedDiagnosisScopeError,
} from "../src/lib/diagnosis/hypotheses";
import type { CellPattern, KnownCell } from "../src/lib/diagnosis/types";
import type { HarnessDimension } from "../src/lib/harness/types";

const DIMS: [HarnessDimension, HarnessDimension] = ["skills", "contextPolicy"];

function cell(label: string, configuration: CellPattern, success: boolean): KnownCell {
  return { label, configuration, success };
}

test("isolationConfiguration/isIsolating: isolating configuration has exactly one dimension at candidate, the rest at baseline", () => {
  const config = isolationConfiguration("skills", DIMS, "candidate");
  assert.deepEqual(config, { skills: "candidate", contextPolicy: "baseline" });
  assert.equal(isIsolating(config, "skills", DIMS), true);
  assert.equal(isIsolating(config, "contextPolicy", DIMS), false);
});

test("evaluateHypotheses: 1 changed dimension resolves immediately from the candidate cell alone", () => {
  const known = [cell("candidate", { skills: "candidate" } as CellPattern, false)];
  const hypotheses = evaluateHypotheses(["skills"], known);
  assert.equal(hypotheses.length, 1);
  assert.equal(hypotheses[0].status, "supported");
  assert.equal(hypotheses[0].type, "main_effect");
  assert.deepEqual(hypotheses[0].factors, ["skills"]);
});

test("evaluateHypotheses: 2 dimensions, no diagnostic cells yet -> everything possible", () => {
  const hypotheses = evaluateHypotheses(DIMS, []);
  assert.equal(hypotheses.length, 3);
  assert.ok(hypotheses.every((h) => h.status === "possible"));
});

test("synthetic: skill only fails -> diagnoses skill main effect", () => {
  const known: KnownCell[] = [
    cell("baseline", { skills: "baseline", contextPolicy: "baseline" }, true),
    cell("candidate", { skills: "candidate", contextPolicy: "candidate" }, false),
    cell("skills=candidate,contextPolicy=baseline", { skills: "candidate", contextPolicy: "baseline" }, false),
  ];
  const hypotheses = evaluateHypotheses(DIMS, known);
  const main = hypotheses.find((h) => h.id === "main_effect:skills")!;
  const interaction = hypotheses.find((h) => h.type === "interaction")!;
  assert.equal(main.status, "supported");
  assert.equal(interaction.status, "rejected");
  assert.ok(main.evidenceFor.length > 0);
});

test("synthetic: context only fails -> diagnoses context main effect", () => {
  const known: KnownCell[] = [
    cell("baseline", { skills: "baseline", contextPolicy: "baseline" }, true),
    cell("candidate", { skills: "candidate", contextPolicy: "candidate" }, false),
    cell("skills=candidate,contextPolicy=baseline", { skills: "candidate", contextPolicy: "baseline" }, true),
    cell("skills=baseline,contextPolicy=candidate", { skills: "baseline", contextPolicy: "candidate" }, false),
  ];
  const hypotheses = evaluateHypotheses(DIMS, known);
  assert.equal(hypotheses.find((h) => h.id === "main_effect:skills")!.status, "rejected");
  assert.equal(hypotheses.find((h) => h.id === "main_effect:contextPolicy")!.status, "supported");
  assert.equal(hypotheses.find((h) => h.type === "interaction")!.status, "rejected");
});

test("synthetic: only the combined configuration fails -> diagnoses interaction", () => {
  const known: KnownCell[] = [
    cell("baseline", { skills: "baseline", contextPolicy: "baseline" }, true),
    cell("candidate", { skills: "candidate", contextPolicy: "candidate" }, false),
    cell("skills=candidate,contextPolicy=baseline", { skills: "candidate", contextPolicy: "baseline" }, true),
    cell("skills=baseline,contextPolicy=candidate", { skills: "baseline", contextPolicy: "candidate" }, true),
  ];
  const hypotheses = evaluateHypotheses(DIMS, known);
  assert.equal(hypotheses.find((h) => h.id === "main_effect:skills")!.status, "rejected");
  assert.equal(hypotheses.find((h) => h.id === "main_effect:contextPolicy")!.status, "rejected");
  const interaction = hypotheses.find((h) => h.type === "interaction")!;
  assert.equal(interaction.status, "supported");
  assert.ok(interaction.evidenceFor.length > 0);
});

test("synthetic: both isolating cells independently fail -> ambiguous, neither main effect cleanly wins, interaction is rejected", () => {
  const known: KnownCell[] = [
    cell("baseline", { skills: "baseline", contextPolicy: "baseline" }, true),
    cell("candidate", { skills: "candidate", contextPolicy: "candidate" }, false),
    cell("skills=candidate,contextPolicy=baseline", { skills: "candidate", contextPolicy: "baseline" }, false),
    cell("skills=baseline,contextPolicy=candidate", { skills: "baseline", contextPolicy: "candidate" }, false),
  ];
  const hypotheses = evaluateHypotheses(DIMS, known);
  assert.equal(hypotheses.find((h) => h.id === "main_effect:skills")!.status, "supported");
  assert.equal(hypotheses.find((h) => h.id === "main_effect:contextPolicy")!.status, "supported");
  assert.equal(hypotheses.find((h) => h.type === "interaction")!.status, "rejected");
});

test("evaluateHypotheses throws UnsupportedDiagnosisScopeError for 0 or 3+ changed dimensions", () => {
  assert.throws(() => evaluateHypotheses([], []), UnsupportedDiagnosisScopeError);
  assert.throws(() => evaluateHypotheses(["model", "systemPrompt", "skills"], []), UnsupportedDiagnosisScopeError);
});
