import assert from "node:assert/strict";
import { test } from "node:test";
import { assertControlledExperiment, diffManifests, UncontrolledExperimentError } from "../src/lib/harness/diff";
import { baselineV1 } from "../src/lib/harness/manifests/baseline-v1";
import { candidateMinimalV1 } from "../src/lib/harness/manifests/candidate-minimal-v1";
import type { HarnessManifest } from "../src/lib/harness/types";

function manifest(overrides: Partial<HarnessManifest> = {}): HarnessManifest {
  return {
    id: "m",
    name: "M",
    model: "model-a",
    systemPrompt: "prompt-a",
    execution: { maxTurns: 8 },
    skills: [],
    contextPolicy: "full",
    ...overrides,
  };
}

test("diffManifests reports no dimensions for identical manifests (ignoring id/name)", () => {
  const a = manifest({ id: "a", name: "A" });
  const b = manifest({ id: "b", name: "B" });
  assert.deepEqual(diffManifests(a, b), []);
});

test("diffManifests reports exactly systemPrompt for the real baseline/candidate pair", () => {
  assert.deepEqual(diffManifests(baselineV1, candidateMinimalV1), ["systemPrompt"]);
});

test("diffManifests reports each differing dimension by name", () => {
  const a = manifest();
  const b = manifest({ model: "model-b", systemPrompt: "prompt-b", execution: { maxTurns: 4 } });
  assert.deepEqual(diffManifests(a, b), ["model", "systemPrompt", "execution.maxTurns"]);
});

test("assertControlledExperiment passes when exactly the expected dimension differs", () => {
  const a = manifest();
  const b = manifest({ systemPrompt: "prompt-b" });
  assert.deepEqual(assertControlledExperiment(a, b, ["systemPrompt"]), ["systemPrompt"]);
});

test("assertControlledExperiment fails fast when an unintended dimension also differs", () => {
  const a = manifest();
  const b = manifest({ systemPrompt: "prompt-b", model: "model-b" });
  assert.throws(() => assertControlledExperiment(a, b, ["systemPrompt"]), UncontrolledExperimentError);
});

test("assertControlledExperiment fails when the expected dimension does not actually differ", () => {
  const a = manifest();
  const b = manifest();
  assert.throws(() => assertControlledExperiment(a, b, ["systemPrompt"]), UncontrolledExperimentError);
});

test("diffManifests detects a skills-only change", () => {
  const a = manifest({ skills: [{ id: "s1", content: "do x" }] });
  const b = manifest({ skills: [{ id: "s2", content: "do y" }] });
  assert.deepEqual(diffManifests(a, b), ["skills"]);
});

test("diffManifests treats identical skills arrays (different object identity) as unchanged", () => {
  const a = manifest({ skills: [{ id: "s1", content: "do x" }] });
  const b = manifest({ skills: [{ id: "s1", content: "do x" }] });
  assert.deepEqual(diffManifests(a, b), []);
});

test("diffManifests detects a contextPolicy-only change", () => {
  const a = manifest({ contextPolicy: "full" });
  const b = manifest({ contextPolicy: "compact" });
  assert.deepEqual(diffManifests(a, b), ["contextPolicy"]);
});
