import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertControlledFactorialExperiment,
  buildFactorialExperiment,
  UncontrolledFactorialExperimentError,
  type FactorDefinition,
} from "../src/lib/harness/factorial";
import type { HarnessManifest } from "../src/lib/harness/types";

const baseManifest: HarnessManifest = {
  id: "base",
  name: "Base",
  model: "model-a",
  systemPrompt: "prompt-a",
  execution: { maxTurns: 8 },
};

const promptFactor: FactorDefinition<string> = { name: "systemPrompt", baselineValue: "prompt-a", candidateValue: "prompt-b" };
const turnsFactor: FactorDefinition<number> = { name: "execution.maxTurns", baselineValue: 8, candidateValue: 7 };

test("buildFactorialExperiment generates exactly four cells", () => {
  const experiment = buildFactorialExperiment("task-1", baseManifest, [promptFactor, turnsFactor]);
  assert.equal(experiment.cells.length, 4);
  assert.equal(new Set(experiment.cells.map((c) => c.id)).size, 4, "cell ids must be unique");
});

test("buildFactorialExperiment covers all four baseline/candidate level combinations", () => {
  const experiment = buildFactorialExperiment("task-1", baseManifest, [promptFactor, turnsFactor]);
  const combos = experiment.cells.map((c) => `${c.factors.systemPrompt}/${c.factors["execution.maxTurns"]}`).sort();
  assert.deepEqual(combos, ["baseline/baseline", "baseline/candidate", "candidate/baseline", "candidate/candidate"]);
});

test("buildFactorialExperiment only varies the two declared factor dimensions", () => {
  const experiment = buildFactorialExperiment("task-1", baseManifest, [promptFactor, turnsFactor]);
  for (const cell of experiment.cells) {
    assert.equal(cell.manifest.model, baseManifest.model);
  }
  const cellA = experiment.cells.find((c) => c.factors.systemPrompt === "baseline" && c.factors["execution.maxTurns"] === "baseline")!;
  const cellD = experiment.cells.find((c) => c.factors.systemPrompt === "candidate" && c.factors["execution.maxTurns"] === "candidate")!;
  assert.equal(cellA.manifest.systemPrompt, "prompt-a");
  assert.equal(cellA.manifest.execution.maxTurns, 8);
  assert.equal(cellD.manifest.systemPrompt, "prompt-b");
  assert.equal(cellD.manifest.execution.maxTurns, 7);
});

test("assertControlledFactorialExperiment passes for a properly built factorial experiment", () => {
  const experiment = buildFactorialExperiment("task-1", baseManifest, [promptFactor, turnsFactor]);
  assert.doesNotThrow(() => assertControlledFactorialExperiment(experiment.cells, ["systemPrompt", "execution.maxTurns"]));
});

test("assertControlledFactorialExperiment fails fast if a cell manifest was hand-edited to vary an unintended dimension", () => {
  const experiment = buildFactorialExperiment("task-1", baseManifest, [promptFactor, turnsFactor]);
  experiment.cells[0].manifest = { ...experiment.cells[0].manifest, model: "different-model" };
  assert.throws(
    () => assertControlledFactorialExperiment(experiment.cells, ["systemPrompt", "execution.maxTurns"]),
    UncontrolledFactorialExperimentError,
  );
});

test("assertControlledFactorialExperiment fails if the expected dimensions never actually vary", () => {
  const experiment = buildFactorialExperiment("task-1", baseManifest, [promptFactor, turnsFactor]);
  assert.throws(
    () => assertControlledFactorialExperiment(experiment.cells, ["systemPrompt"]),
    UncontrolledFactorialExperimentError,
  );
});
