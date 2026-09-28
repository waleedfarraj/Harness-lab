import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateMinimalV1 } from "../src/lib/harness/manifests/candidate-minimal-v1";
import { baselineV1 } from "../src/lib/harness/manifests/baseline-v1";
import { InvalidHarnessManifestError, validateHarnessManifest } from "../src/lib/harness/validate";
import type { HarnessManifest } from "../src/lib/harness/types";

function validManifest(overrides: Partial<HarnessManifest> = {}): HarnessManifest {
  return {
    id: "test-v1",
    name: "Test",
    model: "nvidia/test-model",
    systemPrompt: "Be a good agent.",
    execution: { maxTurns: 5 },
    ...overrides,
  };
}

test("baselineV1 and candidateMinimalV1 are valid manifests", () => {
  assert.doesNotThrow(() => validateHarnessManifest(baselineV1));
  assert.doesNotThrow(() => validateHarnessManifest(candidateMinimalV1));
});

test("accepts a well-formed manifest", () => {
  assert.doesNotThrow(() => validateHarnessManifest(validManifest()));
});

test("rejects an empty id, name, model or systemPrompt", () => {
  for (const field of ["id", "name", "model", "systemPrompt"] as const) {
    assert.throws(() => validateHarnessManifest(validManifest({ [field]: "" })), InvalidHarnessManifestError);
  }
});

test("rejects a non-positive or non-integer maxTurns", () => {
  assert.throws(() => validateHarnessManifest(validManifest({ execution: { maxTurns: 0 } })), InvalidHarnessManifestError);
  assert.throws(() => validateHarnessManifest(validManifest({ execution: { maxTurns: -1 } })), InvalidHarnessManifestError);
  assert.throws(() => validateHarnessManifest(validManifest({ execution: { maxTurns: 2.5 } })), InvalidHarnessManifestError);
});

test("reports every problem at once", () => {
  assert.throws(() => validateHarnessManifest(validManifest({ id: "", name: "" })), (err: unknown) => {
    assert.ok(err instanceof InvalidHarnessManifestError);
    assert.equal(err.problems.length, 2);
    return true;
  });
});
